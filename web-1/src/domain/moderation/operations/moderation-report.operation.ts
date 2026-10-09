/**
 * Content Moderation — Report Operation
 *
 * Creates a content report for a gallery record.
 * Includes rate limiting (5 reports/hour per user) and duplicate detection.
 */

import { DB_CLIENT } from '@app/db/db.client';
import { TIME } from '@kernel/application/constants.config';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { isSerializationConflict } from '@app/db/serialization-conflict';
import { isP2002 } from '@app/db/prisma-error';
import { databaseFailure } from '@app/errors/error-result.helpers';
import {
  GALLERY_RECORD_VISIBILITY_SELECT,
  isGalleryRecordVisibleToViewer,
} from '@domain/gallery/gallery-record-visibility';
import { success, failure } from '@kernel/application/result.types';
import type { OperationResult } from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { GalleryRecordNotFoundError } from '@kernel/domain/gallery/gallery-errors.types';
import type {
  ContentReportRateLimitedError,
  ContentReportDuplicateError,
  ContentReportDuplicatePendingError,
  ContentReportSelfReportError,
} from '@kernel/domain/moderation/moderation-errors.types';
import type { ContentReportReason } from '@kernel/models/moderation/moderation.dto';
import {
  ContentReportReasonValue,
  ContentReportStatusValue,
} from '@kernel/models/db_models.generated.dto';

const VALID_PRISMA_REASONS = Object.values(ContentReportReasonValue);

// DECISION (nie usuwaj tego komentarza):
// Po F1 dedup ContentReportReason = Prisma enum value (UPPERCASE) — direct mapping.
// Fallback do OTHER zachowany dla defensywności (np. nieaktualny klient sends lowercase).
const toValidPrismaReason = (
  reason: ContentReportReason
): ContentReportReason =>
  VALID_PRISMA_REASONS.includes(reason)
    ? reason
    : ContentReportReasonValue.OTHER;

const REPORT_RATE_LIMIT = 5;
const RATE_LIMIT_WINDOW_MS = TIME.MS_PER_HOUR; // 1 hour

type CreateReportParams = {
  gallery_record_id: string;
  reporter_id: string;
  reason: ContentReportReason;
  description?: string | undefined;
};

type CreateReportResult = {
  report_id: string;
};

export const createContentReport_IO = async (
  params: CreateReportParams
): Promise<
  OperationResult<
    CreateReportResult,
    | GalleryRecordNotFoundError
    | ContentReportRateLimitedError
    | ContentReportDuplicateError
    | ContentReportDuplicatePendingError
    | ContentReportSelfReportError
    | DatabaseError
  >
> => {
  const { gallery_record_id, reporter_id, reason, description } = params;

  try {
    // 1. Verify the gallery record exists AND is visible to the reporter (outside TX —
    //    read-only). The select also carries the ownership chain
    //    (gallery_record → created_by_account → created_by_user_id) for the self-report guard.
    const galleryRecord = await DB_CLIENT.use.galleryRecord.findUnique({
      where: { gallery_record_id },
      select: GALLERY_RECORD_VISIBILITY_SELECT,
    });

    // DECISION (nie usuwaj tego komentarza):
    // Report-abuse uses the SAME per-record visibility gate as get-by-id
    // (isGalleryRecordVisibleToViewer: owner / !is_hidden + stylist publicly visible +
    // pinned or ACTIVE pair). Before it, the op checked existence only, so an unpaired or
    // revoked client could report a private unpinned record she gets 404 for everywhere
    // else, an already hidden record went back into the moderation queue, a pinned record
    // of a banned stylist was reportable, and 201-vs-404 made the endpoint an existence
    // oracle. Every miss collapses into the SAME GALLERY_RECORD_NOT_FOUND as a nonexistent
    // id. The owner passes the gate on purpose and is stopped by the self-report guard
    // below (403): she already knows her own record exists, so that is not an oracle.
    if (
      !galleryRecord ||
      !(await isGalleryRecordVisibleToViewer(galleryRecord, reporter_id))
    ) {
      return failure({
        type: 'GALLERY_RECORD_NOT_FOUND',
        recordId: gallery_record_id,
      });
    }

    // DECISION (nie usuwaj tego komentarza):
    // Self-report guard — stylistka NIE może zgłosić własnego gallery record
    // (inflacja moderation queue + brak sensu biznesowego). Porównujemy w przestrzeni
    // users.id, NIE account_id:
    //   - reporter_id = currentUser.id (User.id) — przekazany z sesji w report/index.ts,
    //     FK ContentReport.reporter_id → User.id (schema.prisma),
    //   - właściciel = gallery_record → created_by_account (StylistAccount)
    //     → created_by_user_id (User.id) — ta sama relacja używana w
    //     moderation-admin.operations.ts.
    // reporter == właściciel → failure PRZED utworzeniem reportu. Świadomie NIE
    // używamy CONTENT_REPORT_DUPLICATE (409 "już zgłoszone" — błędna semantyka);
    // self-report to dedykowany błąd mapowany na 403 (patrz error-mapper).
    if (galleryRecord.created_by_account.created_by_user_id === reporter_id) {
      reportIssueBackend({
        namespace: 'MODERATION_SELF_REPORT_BLOCKED',
        message: `User ${reporter_id} attempted to report own gallery record ${gallery_record_id}`,
        payload: { reporter_id, gallery_record_id },
        mode: 'info',
      });
      return failure({
        type: 'CONTENT_REPORT_SELF_REPORT',
        galleryRecordId: gallery_record_id,
        reporterId: reporter_id,
      });
    }

    // DECISION (nie usuwaj tego komentarza):
    // mod-dedup-race + mod-ratelimit-race: rate-limit count + PENDING-duplicate
    // findFirst + create wrapped in a SERIALIZABLE transaction. Oba guardy to
    // check/count-then-act TOCTOU. POPRZEDNI fix (READ COMMITTED + post-create
    // re-count + sentinel-throw) NIE domykał wyścigu: pod READ COMMITTED każdy
    // współbieżny re-count czyta swój własny, przed-commitowy snapshot i NIE widzi
    // jeszcze niezacommitowanych insertów rodzeństwa, więc N równoległych requestów
    // przy count=4 wszystkie widzą finalCount=5 (tylko własny insert) i commitują →
    // breach; analogicznie dwa pierwsze raporty oba widzą pendingDupCount=1 → 2 PENDING.
    // Pod Serializable pre-check count()/findFirst() STAJE SIĘ punktem serializacji:
    // Postgres SSI zakłada predicate-lock (SIReadLock) na zliczanym/odczytywanym
    // zakresie, więc współbieżne requesty, które wszystkie odczytają „pod limitem /
    // brak PENDING" i każdy wstawi wiersz do tego zakresu, tworzą rw-antidependency →
    // przy commicie Postgres aborbuje przegranych z 40001. Efekt: dokładnie 1 PENDING
    // i NIGDY > REPORT_RATE_LIMIT commituje. NIE polegamy na nowym unique-indexie
    // (schema = kernel, poza scope) — guard jest w pełni app-level (Serializable +
    // isSerializationConflict). Post-create re-count + sentinele usunięte jako MARTWY
    // KOD (udowodnione w pairing/export-user-data, że recount sam wyścigu nie domyka).
    // Wzorzec 1:1: pairing-session.operations.ts / export-user-data.operations.ts.
    return await DB_CLIENT.use.$transaction(
      async tx => {
        // 2. Rate limit check: max 5 reports per hour per user — SERIALIZATION POINT.
        const oneHourAgo = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
        const recentReportCount = await tx.contentReport.count({
          where: {
            reporter_id,
            created_at: { gte: oneHourAgo },
          },
        });

        if (recentReportCount >= REPORT_RATE_LIMIT) {
          reportIssueBackend({
            namespace: 'MODERATION_RATE_LIMITED',
            message: `User ${reporter_id} exceeded report rate limit: ${recentReportCount}/${REPORT_RATE_LIMIT} in last hour`,
            payload: { reporter_id, currentCount: recentReportCount },
            mode: 'info',
          });
          return failure({
            type: 'CONTENT_REPORT_RATE_LIMITED' as const,
            currentCount: recentReportCount,
            limit: REPORT_RATE_LIMIT,
          });
        }

        // 3. Duplicate check: block ONLY when a PENDING (still-open) report by this
        // reporter on this record already exists (admin-moderation-4) — SERIALIZATION
        // POINT. A previously resolved (APPROVED) or rejected (REJECTED) report does
        // NOT block a fresh report — the violating content may have reappeared or a new
        // violation occurred. The broad @@unique([gallery_record_id, reporter_id]) was
        // removed (see schema.prisma ContentReport); PENDING-scoping is enforced here,
        // and concurrent double-submit is closed by the Serializable wrapper above.
        const pendingReport = await tx.contentReport.findFirst({
          where: {
            gallery_record_id,
            reporter_id,
            status: ContentReportStatusValue.PENDING,
          },
          select: { id: true },
        });

        if (pendingReport) {
          return failure({
            type: 'CONTENT_REPORT_DUPLICATE_PENDING' as const,
            galleryRecordId: gallery_record_id,
            reporterId: reporter_id,
          });
        }

        // 4. Create the report — reason maps directly to Prisma enum (UPPERCASE)
        const report = await tx.contentReport.create({
          data: {
            gallery_record_id,
            reporter_id,
            reason: toValidPrismaReason(reason),
            description: description || null,
          },
          select: { id: true },
        });

        reportIssueBackend({
          namespace: 'MODERATION_REPORT_CREATED',
          message: `Content report created: ${report.id} for record ${gallery_record_id} by user ${reporter_id}`,
          payload: { reportId: report.id, reason },
          mode: 'info',
        });

        return success({ report_id: report.id });
      },
      { isolationLevel: 'Serializable' }
    );
  } catch (error) {
    // DECISION (nie usuwaj tego komentarza):
    // serialization_failure (40001) = współbieżny report PRZEGRAŁ wyścig o rate-limit
    // (mod-ratelimit-race) LUB o PENDING-dedup (mod-dedup-race) pod Serializable. tx
    // została zrollowana (insert cofnięty), więc loser NIE dołożył ani nadmiarowego
    // raportu (limit trzyma), ani drugiego PENDING (dedup trzyma) — security/inwariant
    // OK. Mapujemy na 429 CONTENT_REPORT_RATE_LIMITED (respondTooManyRequests),
    // RETRYABLE: abort NIE dowodzi breachu — to tylko kolizja zapisu. CELOWO NIE
    // CONTENT_REPORT_DUPLICATE_PENDING (400, non-retryable) ani „limit reached" 403:
    // po retry pre-check (krok 2/3) trafi w JUŻ zacommitowany wiersz zwycięzcy i zwróci
    // poprawny deterministyczny wynik (rate-limited gdy ≥5, duplicate-pending gdy PENDING
    // istnieje, sukces w przeciwnym razie). currentCount nie jest znany w przegranej tx →
    // raportujemy limit jako currentCount (klient i tak dostaje semantykę „zwolnij").
    // isSerializationConflict, NIE sam `code === 'P2034'`: pod @prisma/adapter-pg 40001
    // wychodzi jako DriverAdapterError (TransactionWriteConflict) bez .code — sam P2034
    // to martwy kod. Wzorzec 1:1: pairing-session.operations.ts / export-user-data.
    if (isSerializationConflict(error)) {
      reportIssueBackend({
        namespace: 'MODERATION_RATE_LIMITED',
        message: `Report serialization conflict for user ${reporter_id} on record ${gallery_record_id} — rolled back (retryable 429). Limit: ${REPORT_RATE_LIMIT}`,
        payload: { reporter_id, gallery_record_id, limit: REPORT_RATE_LIMIT },
        mode: 'info',
      });
      return failure({
        type: 'CONTENT_REPORT_RATE_LIMITED',
        currentCount: REPORT_RATE_LIMIT,
        limit: REPORT_RATE_LIMIT,
      });
    }
    // DECISION (nie usuwaj tego komentarza):
    // P2002 here is now a DEFENSIVE FALLBACK only. The broad
    // @@unique([gallery_record_id, reporter_id]) was removed (re-report support,
    // admin-moderation-4), so a same-reporter+same-record insert no longer raises
    // P2002 — the PENDING-duplicate concurrency race is now closed by the Serializable
    // wrapper above (loser → 40001 → isSerializationConflict → retryable 429). A P2002
    // could now surface only from the id PK (cuid collision — astronomically rare) or
    // a future constraint; we still map it to CONTENT_REPORT_DUPLICATE rather than
    // mask a real DB error. Every OTHER throw → databaseFailure (logs message+stack,
    // returns DATABASE_ERROR → 500). Mirrors admin-policies / gallery ops.
    // Detekcja STRUKTURALNA (isP2002), NIE `instanceof Prisma.PrismaClientKnownRequestError`
    // — instanceof zwraca FALSE pod Turbopack (zdublowane tożsamości klasy), przeskoczyłby ten
    // fallback → 500 zamiast 409 CONTENT_REPORT_DUPLICATE. Rationale: @app/db/prisma-error.ts.
    if (isP2002(error)) {
      return failure({
        type: 'CONTENT_REPORT_DUPLICATE',
        galleryRecordId: gallery_record_id,
        reporterId: reporter_id,
      });
    }
    return databaseFailure('createContentReport', error);
  }
};
