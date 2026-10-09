/**
 * SessionContainer QUERY operations (R8)
 *
 * Queries: getMy, getById
 */

import { DB_CLIENT } from '@app/db/db.client';
import { SessionContainerLifecycleStateValue } from '@kernel/models/db_models.generated.dto';
import type {
  SessionContainerDTO,
  SessionContainerDetailDTO,
} from '@kernel/models/session-container/session-container.dto';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  SessionContainerNotAuthorizedError,
  SessionContainerNotFoundError,
} from '@kernel/domain/session-container/session-container-errors.types';
import type {
  DatabaseError,
  ValidationError,
} from '@kernel/application/common-errors.types';
import { isP2025 } from '@app/db/prisma-error';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { isValidCursorFormat } from '@kernel/policies/validation/validation.utils';
import type { Prisma } from '../../../prisma/js-client';
import {
  mapSessionToDTO,
  mapSessionToDetailDTO,
  toDtoLifecycleState,
  resolveViewerSide,
  SHARED_STATES_FOR_PRISMA,
  CLIENT_NAME_INCLUDE,
  type PhotoWithOptionalGalleryRecord,
  type SessionRowWithClient,
  type SessionViewerSide,
} from './session-container-shared.operations';

// ─── 5. GET MY ────────────────────────────────────────────────────────────

/**
 * Get my session containers with cursor pagination (default 50, max 100).
 * Cursor by SessionContainer.id; orderBy id desc for stable cursor traversal.
 */
export const getMySessionContainers_IO = async ({
  client_account_id,
  stylist_account_id,
  cursor,
  take = 50,
}: {
  client_account_id: string | undefined;
  stylist_account_id: string | undefined;
  cursor?: string;
  take?: number;
}): Promise<
  OperationResult<
    { sessions: SessionContainerDTO[]; nextCursor: string | null },
    DatabaseError | ValidationError
  >
> => {
  const now = new Date();
  const effectiveTake = Math.min(Math.max(take, 1), 100);

  // Viewer's own-set filter (client: all their sessions; stylist: only SHARED/ACTIVE
  // not-expired). Built ONCE and reused for BOTH the cursor existence pre-check and the
  // main list query, so the two cannot drift (SSOT within the function).
  const viewerOr: Prisma.SessionContainerWhereInput[] = [
    ...(client_account_id ? [{ client_account_id }] : []),
    ...(stylist_account_id
      ? [
          {
            stylist_account_id,
            lifecycle_state: { in: [...SHARED_STATES_FOR_PRISMA] },
            OR: [{ expires_at: null }, { expires_at: { gt: now } }],
          },
        ]
      : []),
  ];

  // DECISION (nie usuwaj tego komentarza):
  // Uniform cursor contract. (1) Format-gate: null-byte / non-cuid cursor rzucałby w Prisma
  // → niezmapowany 500; isValidCursorFormat (@kernel — SSOT) zwraca VALIDATION_ERROR 400.
  // (2) Existence pre-check SCOPED do zbioru callera (findFirst {id: cursor, OR: viewerOr},
  // ten SAM filtr co główne query): findMany dla stale cursora zwraca PUSTY zbiór (NIE P2025),
  // więc bez pre-checka 200 + sessions:[] jest nieodróżnialne od końca listy.
  //
  // ANTI-ENUMERATION: scope PO viewerOr (nie gołe findUnique po PK) zamyka existence-oracle —
  // obcy-ale-żywy cursor-id (sesji CUDZEGO client+stylist) i nieistniejący cuid dają OBA to samo
  // VALIDATION_ERROR 400, więc attacker nie odróżni „ta sesja istnieje" od „nie istnieje". Parytet
  // z siostrzanymi PRYWATNYMI listami: getSupportThreads_IO (resolveSupportThreadCursor),
  // getMyPairs_IO (NR-1), getClientVisits_IO (findFirst {...where, id}). Wcześniej pre-check był
  // BEZ scope (findUnique po PK) — outlier vs to rodzeństwo, domknięty tu.
  //
  // CONTRAST (świadomy, NIE kopiować tu): gallery-explore.query.ts / gallery-list.query.ts /
  // public-stylists-list celowo NIE scope'ują (findUnique po PK) — tam dane są PUBLICZNE (id
  // widoczne w publicznym feedzie => brak oracle), a unscoped daje robustność „wiersz ukryty/
  // nieaktywny mid-scroll nadal jest valid anchorem dla skip:1". Tu odwrotny priorytet: dane
  // PRYWATNE => anti-enumeration wygrywa nad tą robustnością.
  //
  // TRADEOFF (uczciwie): dla ścieżki STYLISTKI viewerOr zawiera lifecycle IN SHARED_STATES +
  // expires_at > now, więc sesja która WYGAŚNIE / zmieni stan MIĘDZY dwoma fetchami strony robi
  // swój cursor stale => 400 „Invalid cursor". To NIE regresja legalnej paginacji, tylko ten sam
  // handled stale-cursor kontrakt, na który frontend już reaguje refetchem od pierwszej strony
  // (patrz gallery-explore DECISION o tym kontrakcie). Okno = sekundy między fetchami vs TTL sesji
  // w godzinach/dniach => astronomicznie rzadkie, degradacja graceful. Ścieżka KLIENTKI
  // ({client_account_id}, bez volatile-warunków) jest w pełni stabilna. P2025-branch w catch
  // poniżej zostaje jako nieszkodliwy fallback.
  if (cursor !== undefined) {
    if (!isValidCursorFormat(cursor)) {
      return failure({
        type: 'VALIDATION_ERROR',
        field: 'cursor',
        message: 'Invalid cursor',
      });
    }
    try {
      const cursorRow = await DB_CLIENT.use.sessionContainer.findFirst({
        where: { id: cursor, OR: viewerOr },
        select: { id: true },
      });
      if (!cursorRow) {
        return failure({
          type: 'VALIDATION_ERROR',
          field: 'cursor',
          message: 'Invalid cursor',
        });
      }
    } catch (error) {
      return databaseFailure('getMySessionContainers_IO:cursorCheck', error);
    }
  }

  try {
    // Gather sessions for client (all their sessions) and stylist (only SHARED/ACTIVE not expired)
    const sessions = await DB_CLIENT.use.sessionContainer.findMany({
      where: { OR: viewerOr },
      orderBy: [{ id: 'desc' }],
      take: effectiveTake + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        _count: { select: { photos: true } },
        // Hydrate the owning client's display name so the stylist inbox shows
        // WHO shared each session (SSOT include — mirrors loadSessionDetail_IO).
        ...CLIENT_NAME_INCLUDE,
      },
    });

    const hasMore = sessions.length > effectiveTake;
    const pageItems = hasMore ? sessions.slice(0, effectiveTake) : sessions;
    const nextCursor =
      hasMore && pageItems.length > 0
        ? (pageItems[pageItems.length - 1]?.id ?? null)
        : null;

    return success({
      // Per-row viewer-side masking: a get-my caller may be the owning client of
      // some rows AND the assigned stylist of others (the OR query above mixes
      // both). stylistNote is revealed only on rows where THIS reader is the
      // assigned stylist; on her own client-owned rows it is masked
      // (DOMAIN_SSOT §3.2 — stylist-private). See resolveViewerSide.
      sessions: pageItems.map(s => {
        const row = s as SessionRowWithClient;
        return mapSessionToDTO(
          row,
          s._count.photos,
          resolveViewerSide({
            sessionStylistAccountId: row.stylist_account_id ?? null,
            viewerStylistAccountId: stylist_account_id,
          })
        );
      }),
      nextCursor,
    });
  } catch (error) {
    // DECISION (nie usuwaj tego komentarza):
    // Invalid/stale-cursor handling lives in the EXPLICIT pre-check at the top of this
    // function (format-gate + findUnique → VALIDATION_ERROR 400). Prisma `findMany`
    // returns an EMPTY result set for a non-existent cursor and does NOT throw P2025
    // (P2025 is for single-record ops), so this branch is a harmless defensive fallback
    // only — kept so a stale cursor never maps to a 503 Postgres-outage-looking event.
    if (isP2025(error)) {
      return failure({
        type: 'VALIDATION_ERROR',
        field: 'cursor',
        message: 'Invalid cursor',
      });
    }
    return databaseFailure('getMySessionContainers_IO', error);
  }
};

// ─── 6. GET BY ID ─────────────────────────────────────────────────────────

export const loadSessionDetail_IO = async (
  session_id: string,
  // DECISION (nie usuwaj tego komentarza): viewerSide jest OPCJONALNY i DOMYŚLNIE
  // maskuje stylistNote (=> 'client'). add-photo woła loadSessionDetail bez tej
  // flagi i jest ścieżką client-only (requireClientAccount) — domyślne maskowanie
  // jest tam poprawne. Ujawnienie stylistNote NASTĘPUJE wyłącznie z get-by-id, gdy
  // potwierdzono, że reader to przypisana stylistka (viewerSide==='stylist').
  viewerSide?: SessionViewerSide
): Promise<
  OperationResult<
    SessionContainerDetailDTO,
    SessionContainerNotFoundError | DatabaseError
  >
> => {
  // DECISION (nie usuwaj tego komentarza):
  // try/catch wrap (DD2-A4). Previously this function had no try/catch — DB errors
  // throw instead of returning a failure result, leaving consumer call sites
  // (addPhotoToSessionContainer_IO L300) with uncaught rejections. The return type
  // now includes DatabaseError; consumers must handle DATABASE_ERROR via
  // mapErrorToResponse (already exhaustive in error-mapper).
  try {
    const [session, photosWithRecord, totalPhotoCount] = await Promise.all([
      DB_CLIENT.use.sessionContainer.findUnique({
        where: { id: session_id },
        // Hydrate the owning client's display name (SSOT include) so the stylist
        // detail view credits the sender by name — mirrors getMySessionContainers_IO.
        include: CLIENT_NAME_INCLUDE,
      }),
      DB_CLIENT.use.sessionContainerPhoto.findMany({
        where: { session_id },
        orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
        // DECISION: photos capped na 200 per session — pre-launch limit (typowo <50 photos per session).
        // Jesli MVP uzytkownicy przekrocza, dodac `has_more` indicator + pagination.
        // SESSION_CONTAINER_CONFIG nie ma SESSION_MAX_PHOTOS — to runtime cap, nie business rule.
        take: 200,
      }),
      // DECISION (nie usuwaj tego komentarza): photoCount liczony NIEZALEŻNIE od cap'a
      // take:200 powyżej, żeby detail raportował tę samą liczbę co get-my (_count.photos,
      // uncapped). Bez tego sesja >200 zdjęć pokazywałaby 200 w detalu a rzeczywistą liczbę
      // na liście. Tani count() zamiast derywacji z uciętej tablicy.
      DB_CLIENT.use.sessionContainerPhoto.count({ where: { session_id } }),
    ]);

    // Hydrate gallery records (single batch read)
    const galleryRecordIds = photosWithRecord.map(p => p.gallery_record_id);
    const records = galleryRecordIds.length
      ? await DB_CLIENT.use.galleryRecord.findMany({
          where: { gallery_record_id: { in: galleryRecordIds } },
          select: {
            gallery_record_id: true,
            asset_url: true,
            nail_length: true,
            is_pinned: true,
            created_by_account_id: true,
            // is_hidden pobierany do maskowania (finding sc-addphoto-2 read-side);
            // NIE trafia do gallery_record_data — jawnie strip poniżej, by nie wyciekł do DTO.
            is_hidden: true,
          },
          take: 200,
        })
      : [];
    const recordMap = new Map(records.map(r => [r.gallery_record_id, r]));

    if (!session) {
      return failure({
        type: 'SESSION_CONTAINER_NOT_FOUND',
        sessionId: session_id,
      });
    }

    // DECISION (nie usuwaj tego komentarza): maskuj rekord moderation-hidden dla klientki
    // (finding sc-addphoto-2 read-side) — parytet z gallery-detail (is_hidden maskowany dla
    // non-ownerów) i favorite. KAŻDY rekord sesji należy do stylistki sesji (add-photo
    // egzekwuje ownership), więc "stylist viewer" == owner → widzi własny hidden content
    // (owner-bypass); klientka (default/'client') dostaje gallery_record_data === null.
    // Backstop na hide-AFTER-add: write-path add-photo już odrzuca hidden na wejściu, ale
    // rekord dodany legalnie i PÓŹNIEJ zdjęty moderacją musi zniknąć klientce też z sesji.
    // is_hidden jawnie strip (recData bez niego) — inaczej wyciekłby do galleryRecord w DTO.
    const maskHidden = viewerSide !== 'stylist';
    const photos: PhotoWithOptionalGalleryRecord[] = photosWithRecord.map(p => {
      const rec = recordMap.get(p.gallery_record_id);
      if (!rec || (maskHidden && rec.is_hidden)) {
        return { ...p, gallery_record_data: null };
      }
      return {
        ...p,
        gallery_record_data: {
          gallery_record_id: rec.gallery_record_id,
          asset_url: rec.asset_url,
          nail_length: rec.nail_length,
          is_pinned: rec.is_pinned,
          created_by_account_id: rec.created_by_account_id,
        },
      };
    });

    return success(
      mapSessionToDetailDTO(session, photos, totalPhotoCount, viewerSide)
    );
  } catch (error) {
    return databaseFailure('loadSessionDetail', error);
  }
};

export const getSessionContainerById_IO = async ({
  session_id,
  client_account_id,
  stylist_account_id,
  user_id,
}: {
  session_id: string;
  client_account_id: string | undefined;
  stylist_account_id: string | undefined;
  user_id: string;
}): Promise<
  OperationResult<
    SessionContainerDetailDTO,
    | SessionContainerNotFoundError
    | SessionContainerNotAuthorizedError
    | DatabaseError
  >
> => {
  let session;
  try {
    session = await DB_CLIENT.use.sessionContainer.findUnique({
      where: { id: session_id },
      select: {
        id: true,
        client_account_id: true,
        stylist_account_id: true,
        lifecycle_state: true,
        expires_at: true,
        // shared_at: null = container was NEVER shared to the assigned stylist.
        // Needed by the SCCAP-3 terminal-never-shared guard below (session-close-edge).
        shared_at: true,
      },
    });
  } catch (error) {
    return databaseFailure('getSessionContainerById', error);
  }

  if (!session) {
    return failure({
      type: 'SESSION_CONTAINER_NOT_FOUND',
      sessionId: session_id,
    });
  }

  const isOwningClient =
    Boolean(client_account_id) &&
    session.client_account_id === client_account_id;
  const isAssignedStylist =
    Boolean(stylist_account_id) &&
    session.stylist_account_id === stylist_account_id;

  if (!isOwningClient && !isAssignedStylist) {
    return failure({
      type: 'SESSION_CONTAINER_NOT_AUTHORIZED',
      sessionId: session_id,
      userId: user_id,
    });
  }

  // Stylist may NOT see DRAFT/READY (those are client-private)
  if (isAssignedStylist && !isOwningClient) {
    const state = toDtoLifecycleState(session.lifecycle_state);
    if (
      state === SessionContainerLifecycleStateValue.DRAFT ||
      state === SessionContainerLifecycleStateValue.READY
    ) {
      return failure({
        type: 'SESSION_CONTAINER_NOT_AUTHORIZED',
        sessionId: session_id,
        userId: user_id,
      });
    }
  }

  // DECISION (nie usuwaj tego komentarza): SCCAP-3 (session-close-edge) — terminal
  // never-shared guard. The DRAFT/READY guard above covers pre-share states; this
  // closes the post-terminal hole: when an owner CLOSES (or lets EXPIRE) a container
  // that was assigned to a stylist but NEVER shared (shared_at === null), it lands in
  // CLOSED/EXPIRED with shared_at still null — without this it falls through to
  // loadSessionDetail_IO and leaks name + clientNote to the assigned-but-never-shared
  // stylist. "Assigned" ≠ "shared": a container shared THEN closed (shared_at set) stays
  // readable as the stylist's CRM archive (DOMAIN_SSOT §3.2). Reaching this point the
  // state is already non-DRAFT/READY, so shared_at === null ⟺ terminal-never-shared.
  // Owner bypasses (isOwningClient). Mirrored in closeSessionContainer_IO.
  if (isAssignedStylist && !isOwningClient && session.shared_at === null) {
    return failure({
      type: 'SESSION_CONTAINER_NOT_AUTHORIZED',
      sessionId: session_id,
      userId: user_id,
    });
  }

  // Read-side field authorization: reveal stylistNote ONLY to the assigned
  // stylist (DOMAIN_SSOT §3.2 — stylist-private). The owning client (incl. the
  // case where she reads a session she also happens to be paired on) gets it
  // masked. The DRAFT/READY-for-stylist case was already rejected above, so a
  // 'stylist' viewerSide here only ever sees SHARED/ACTIVE — but resolveViewerSide
  // keys off ownership, not state, which is the correct invariant.
  // DECISION (nie usuwaj tego komentarza): isOwningClient ma pierwszeństwo —
  // gdyby (skrajnie) reader był i właścicielką-klientką, i przypisaną stylistką
  // tej samej sesji, traktujemy go jak klientkę (mask), bo własność klientki jest
  // ścieżką uprzywilejowaną dostępu (widzi DRAFT/READY); stylistNote pozostaje
  // jej własną prywatną notatką tylko w roli stylistki.
  const viewerSide: SessionViewerSide =
    !isOwningClient && isAssignedStylist
      ? resolveViewerSide({
          sessionStylistAccountId: session.stylist_account_id,
          viewerStylistAccountId: stylist_account_id,
        })
      : 'client';

  // loadSessionDetail_IO now returns DatabaseError on DB failure (DD2-A4) —
  // no need for an outer try/catch.
  return await loadSessionDetail_IO(session_id, viewerSide);
};
