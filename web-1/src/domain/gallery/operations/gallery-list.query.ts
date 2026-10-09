import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { databaseFailure } from '@app/errors/error-result.helpers';
import type { IDType } from '@kernel/application/application.types';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';
import type { Prisma } from '../../../prisma/js-client';
import {
  GALLERY_COLORS_TRAITS_SELECT,
  mapGalleryColors,
  mapGalleryTraits,
} from '@domain/gallery/gallery.utils.api';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  ValidationError,
  DatabaseError,
} from '@kernel/application/common-errors.types';
import type { NailLength } from '@kernel/domain/gallery/nail-length.config';
import {
  assertType,
  isNailLengthNarrower,
} from '@kernel/models/type_narrowing';
import { isP2025 } from '@app/db/prisma-error';
import { isValidCursorFormat } from '@kernel/policies/validation/validation.utils';

/**
 * Get gallery records with optional filtering via junction tables.
 * Cursor-paginated (default 50, max 100). Cursor by gallery_record_id.
 */
export const getGalleryRecords_IO = async ({
  props,
}: {
  props: {
    created_by_account_id: IDType;
    gallery_record_id?: IDType | undefined;
    color_ids: IDType[];
    trait_ids: IDType[];
    apply_strict_filter: boolean;
    nail_length?: NailLength;
    cursor?: string | undefined;
    take?: number | undefined;
  };
}): Promise<
  OperationResult<
    GALLERY_DTO_API_V1['GET_GALLERY_RECORDS']['RESPONSE'],
    ValidationError | DatabaseError
  >
> => {
  const {
    created_by_account_id,
    gallery_record_id,
    color_ids = [],
    trait_ids = [],
    apply_strict_filter,
    nail_length,
    cursor,
    take = 50,
  } = props;

  if (!created_by_account_id) {
    reportIssueBackend({
      namespace: 'getGalleryRecords_IO',
      message: `no accountID.`,
      payload: created_by_account_id,
      mode: 'error',
    });
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'created_by_account_id',
      message: 'Missing account ID',
    });
  }

  const effectiveTake = Math.min(Math.max(take, 1), 100);

  const where: Prisma.GalleryRecordWhereInput = {
    ...(gallery_record_id !== undefined && { gallery_record_id }),
    created_by_account_id,
    ...(nail_length && { nail_length }),
  };

  // Filter by colors via junction table
  if (color_ids.length > 0) {
    if (apply_strict_filter) {
      // Must have ALL specified colors
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : []),
        ...color_ids.map(cid => ({
          colors: { some: { color_id: cid } },
        })),
      ];
    } else {
      // Must have at least ONE specified color
      where.colors = { some: { color_id: { in: color_ids } } };
    }
  }

  // Filter by traits via junction table
  if (trait_ids.length > 0) {
    if (apply_strict_filter) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : []),
        ...trait_ids.map(tid => ({
          traits: { some: { trait_id: tid } },
        })),
      ];
    } else {
      where.traits = { some: { trait_id: { in: trait_ids } } };
    }
  }

  // DECISION (nie usuwaj tego komentarza):
  // Uniform cursor contract dla OWNER-SCOPED listy (ta op zwraca WYŁĄCZNIE rekordy
  // created_by_account_id = konto z SESJI callera — handler bierze account_id z
  // requireStylistAccount, NIE z body). (1) Format-gate ZANIM cursor trafi do Prisma:
  // null-byte (\0) / non-cuid cursor rzucałby w findFirst/findMany → niezmapowany 500;
  // isValidCursorFormat (@kernel validation.utils — SSOT) odrzuca go jako VALIDATION_ERROR
  // 400. (2) Existence pre-check SCOPED do created_by_account_id (ten SAM ownership co
  // główne query): findMany dla stale cursora zwraca PUSTY zbiór (NIE P2025), więc bez
  // pre-checka stale cursor cicho dawał 200 + records:[] — nieodróżnialne od końca listy,
  // łamiąc kontrakt 400 'Invalid cursor'.
  //
  // ANTI-ENUMERATION (finding testy-api GAL-1): scope PO created_by_account_id (nie gołe
  // findUnique po PK) zamyka existence-oracle. Bez scope obcy-ale-żywy gallery_record_id
  // (rekord CUDZEJ stylistki) dawał 200 (istnieje), a nieistniejący 400 — rozróżnialne
  // (zweryfikowane runtime: foreign admin-record → 200, nonexistent → 400). To ujawniało
  // istnienie CUDZYCH rekordów, w tym is_hidden (moderation-hidden) — których get-record-by-id
  // celowo MASKUJE (404 dla nie-właściciela). Po scope obcy i nieistniejący cursor dają OBA
  // 400, spójnie z maską detail-by-id. Parytet z siostrzanymi OWNER-SCOPED listami:
  // getSupportThreads_IO (resolveSupportThreadCursor), getMyPairs_IO (NR-1), getClientVisits_IO,
  // getMySessionContainers_IO (O4). Zero-cost i strictly-more-correct BEZ tradeoffu: legalny
  // nextCursor to ZAWSZE ostatni rekord WŁASNEJ strony callera (created_by_account_id stabilne —
  // rekord nie zmienia właściciela), więc scope nigdy nie odrzuca legalnej paginacji
  // (zweryfikowane: own-cursor next-page 200 + differs). Filtry (nail_length/colors/traits)
  // celowo POZA existence-checkiem — ownership wystarcza do anty-oracle, a rekord ukryty/
  // odfiltrowany nadal jest valid anchorem dla skip:1.
  //
  // CONTRAST (świadomy, NIE kopiować tu): gallery-explore.query.ts / gallery-list PUBLIC-feed
  // siblingi (public-stylists-list) NIE scope'ują (findUnique po PK) — tam dane PUBLICZNE (id w
  // publicznym feedzie => brak oracle) + robustność mid-scroll. Ta op to prywatna lista własna,
  // NIE public feed — dlatego owner-scope, nie unscoped. P2025-branch w catch poniżej zostaje
  // jako nieszkodliwy fallback.
  if (cursor !== undefined) {
    if (!isValidCursorFormat(cursor)) {
      return failure({
        type: 'VALIDATION_ERROR',
        field: 'cursor',
        message: 'Invalid cursor',
      });
    }
    try {
      const cursorRow = await DB_CLIENT.use.galleryRecord.findFirst({
        where: { gallery_record_id: cursor, created_by_account_id },
        select: { gallery_record_id: true },
      });
      if (!cursorRow) {
        return failure({
          type: 'VALIDATION_ERROR',
          field: 'cursor',
          message: 'Invalid cursor',
        });
      }
    } catch (error) {
      return databaseFailure('getGalleryRecords_IO:cursorCheck', error);
    }
  }

  try {
    const records = await DB_CLIENT.use.galleryRecord.findMany({
      where,
      include: { ...GALLERY_COLORS_TRAITS_SELECT },
      orderBy: [{ created_at: 'desc' }, { gallery_record_id: 'desc' }],
      take: effectiveTake + 1,
      ...(cursor ? { cursor: { gallery_record_id: cursor }, skip: 1 } : {}),
    });

    const hasMore = records.length > effectiveTake;
    const pageItems = hasMore ? records.slice(0, effectiveTake) : records;

    const mapped: GALLERY_DTO_API_V1['GET_GALLERY_RECORDS']['RESPONSE']['records'] =
      pageItems.map(r => ({
        gallery_record_id: r.gallery_record_id,
        asset_url: r.asset_url,
        nail_length: assertType(
          r.nail_length,
          isNailLengthNarrower,
          'nail_length in getGalleryRecords_IO'
        ),
        is_pinned: r.is_pinned,
        colors: mapGalleryColors(r.colors),
        traits: mapGalleryTraits(r.traits),
        created_at: r.created_at,
      }));

    const nextCursor =
      hasMore && pageItems.length > 0
        ? (pageItems[pageItems.length - 1]?.gallery_record_id ?? null)
        : null;

    return success({ records: mapped, nextCursor });
  } catch (error: unknown) {
    // DECISION (nie usuwaj tego komentarza):
    // P2025 ("record not found") na cursor query oznacza, że klient przesłał
    // nieistniejący/stale cursor — to błąd walidacji wejścia (HTTP 400),
    // nie awaria DB (HTTP 503). Bez tego rozróżnienia każdy stale cursor
    // wyglądałby jak Postgres outage w event logu.
    if (isP2025(error)) {
      return failure({
        type: 'VALIDATION_ERROR',
        field: 'cursor',
        message: 'Invalid cursor',
      });
    }
    return databaseFailure('getGalleryRecords_IO', error);
  }
};
