import { DB_CLIENT } from '@app/db/db.client';
import { escapeLikePattern } from '@app/db/like-escape';
import { databaseFailure } from '@app/errors/error-result.helpers';
import type { IDType } from '@kernel/application/application.types';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';
import {
  assertType,
  isNailLengthNarrower,
} from '@kernel/models/type_narrowing';
import { isP2025 } from '@app/db/prisma-error';
import type { Prisma } from '../../../prisma/js-client';
import {
  GALLERY_COLORS_TRAITS_SELECT,
  mapGalleryColors,
  mapGalleryTraits,
} from '@domain/gallery/gallery.utils.api';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  DatabaseError,
  ValidationError,
} from '@kernel/application/common-errors.types';
import type { NailLength } from '@kernel/domain/gallery/nail-length.config';
import { STYLIST_PUBLICLY_VISIBLE } from '@domain/account/account.config';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { isValidCursorFormat } from '@kernel/policies/validation/validation.utils';

/**
 * Explore gallery records cross-stylist with cursor-based pagination.
 * Returns records from ALL active stylists (no created_by_account_id scope).
 * Filters: color_ids, trait_ids, nail_length, apply_strict_filter, city, searchQuery.
 * Security: Only records from ACTIVE accounts, only visible records.
 *
 * city / searchQuery (added MIG-B3 backend slice):
 * - city: case-insensitive equality on stylist's address_city (uses StylistAccount index)
 * - searchQuery: case-insensitive substring match on stylist display_name + business_name
 *   + city + color name + trait name (OR). Bounded length (validator caps at 100 chars)
 *   so query stays index-scoped to bounded sets.
 */
export const exploreGalleryRecords_IO = async ({
  color_ids,
  trait_ids,
  nail_length,
  apply_strict_filter = false,
  cursor,
  take = 30,
  city,
  searchQuery,
  currentUserId,
}: {
  color_ids?: IDType[];
  trait_ids?: IDType[];
  nail_length?: NailLength;
  apply_strict_filter?: boolean;
  cursor?: string;
  take?: number;
  city?: string;
  searchQuery?: string;
  currentUserId: string;
}): Promise<
  OperationResult<
    GALLERY_DTO_API_V1['EXPLORE_GALLERY_RECORDS']['RESPONSE'],
    DatabaseError | ValidationError
  >
> => {
  // Clamp both bounds (parytet z gallery-list.query.ts): lower clamp chroni przed
  // take<=0 od hipotetycznego innego callera (take=0→1, ujemny→Prisma bierze od końca);
  // HTTP handler i tak clampuje [1,50], to defense-in-depth spójne z siostrzanym query.
  const effectiveTake = Math.min(Math.max(take, 1), 50);

  // DECISION (nie usuwaj tego komentarza):
  // Cursor existence MUST be validated explicitly before findMany. Prisma findMany has
  // different cursor semantics than findUnique/update/delete: a non-existent/stale cursor
  // returns an EMPTY result set, it does NOT throw P2025. Without this pre-check a stale
  // cursor silently produced 200 + records:[] + nextCursor:null — indistinguishable from a
  // genuine end-of-list, breaking the documented 400 "Invalid cursor" contract the frontend
  // relies on. We verify the cursor row exists (cheap PK lookup) and return VALIDATION_ERROR
  // (HTTP 400) when it doesn't. NOTE: existence is checked WITHOUT the active-account/visibility
  // filter on purpose — the cursor is an internal pagination token (a previously-returned id),
  // not a content query; a row that later became hidden/inactive is still a valid anchor for
  // `skip:1` ordering, so we only reject cursors that point at NO row at all.
  if (cursor !== undefined) {
    // DECISION (nie usuwaj tego komentarza):
    // Format-gate ZANIM cursor trafi do findUnique poniżej (wzorzec SSOT z
    // isValidCursorFormat @kernel validation.utils). Bez tego null-byte (\0) lub
    // inny niezgodny z PG `text` cursor rzucał w findUnique → niezmapowany 500
    // GENERAL_ERROR. Malformowany format = ten sam kontrakt co stale cursor:
    // VALIDATION_ERROR 400 'Invalid cursor'.
    if (!isValidCursorFormat(cursor)) {
      return failure({
        type: 'VALIDATION_ERROR',
        field: 'cursor',
        message: 'Invalid cursor',
      });
    }
    try {
      const cursorRow = await DB_CLIENT.use.galleryRecord.findUnique({
        where: { gallery_record_id: cursor },
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
      return databaseFailure('exploreGalleryRecords_IO:cursorCheck', error);
    }
  }

  const trimmedCity = typeof city === 'string' ? city.trim() : '';
  const trimmedSearch =
    typeof searchQuery === 'string' ? searchQuery.trim() : '';

  // Build the StylistAccount filter — combines the shared public-visibility invariant
  // (STYLIST_PUBLICLY_VISIBLE) with an optional city filter. Spread (not reference) so the
  // optional address_city below mutates this local copy, never the shared const.
  const stylistAccountFilter: Prisma.StylistAccountWhereInput = {
    ...STYLIST_PUBLICLY_VISIBLE,
  };

  if (trimmedCity.length > 0) {
    stylistAccountFilter.address_city = {
      // escapeLikePattern: `equals` + mode:'insensitive' compiles to ILIKE on Postgres →
      // a city value ending in `\` would crash the query (unmapped 500). See like-escape.ts.
      equals: escapeLikePattern(trimmedCity),
      mode: 'insensitive',
    };
  }

  const where: Prisma.GalleryRecordWhereInput = {
    // Only from active accounts (not deactivated, expired, etc.)
    created_by_account: stylistAccountFilter,
    // Exclude records hidden by moderation
    is_hidden: false,
    // DECISION (nie usuwaj tego komentarza) — finding testy-api gallery-explore-unpinned:
    // Explore = PUBLIC PINNED ONLY (DOMAIN_SSOT §4.4 „Wyłącznie public pinned zdjęcia",
    // decyzja produktowa 2026-04-28 „public pinned only, no extra layers"; §4.1 profil TYLKO
    // pinned, pełna galeria za pairing-gate; §4.2 wszystkie zdjęcia incl. unpinned = dostępne
    // dopiero po ACTIVE pairing). Bez tego filtra Explore zwracał także NIEPINOWANE rekordy
    // (asset_url + PII stylistki) KAŻDEMU zalogowanemu widzowi — wyciek pairing-gated contentu
    // do niesparowanych (zweryfikowane runtime). Parytet z siostrzanym public-profile
    // (gallery-public.operations.ts — publicGetGalleryRecordsByAccount_IO ma ten sam is_pinned:true).
    is_pinned: true,
  };

  // Filter by nail_length
  if (nail_length) {
    where.nail_length = nail_length;
  }

  // Filter by colors via junction table (AND/OR)
  if (color_ids && color_ids.length > 0) {
    if (apply_strict_filter) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : []),
        ...color_ids.map(cid => ({
          colors: { some: { color_id: cid } },
        })),
      ];
    } else {
      where.colors = { some: { color_id: { in: color_ids } } };
    }
  }

  // Filter by traits via junction table (AND/OR)
  if (trait_ids && trait_ids.length > 0) {
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

  // Fuzzy text search across stylist + traits/colors (OR).
  // Description on GalleryRecord doesn't exist in the schema, so we search:
  // - stylist display_name / business_name / address_city
  // - color name (via junction)
  // - trait name (via junction)
  //
  // DECISION (nie usuwaj tego komentarza):
  // `contains: mode:'insensitive'` na Color.name / Trait.name (przez junction) BEZ
  // trigram (gin_trgm_ops) index jest swiadome przy obecnej skali: Color ~15, Trait
  // ~30 wierszy to kontrolowane slowniki (NIE user-generated), wiec seq scan =
  // mikrosekundy. Gdyby kiedys staly sie user-generated i urosly do tysiecy: dodac
  // @@index([name(ops: raw('gin_trgm_ops'))], type: Gin) na Color/Trait.
  if (trimmedSearch.length > 0) {
    // Escape LIKE metacharacters so `%`/`_` in searchQuery match literally (a bare `%`
    // otherwise wildcard-matched every record) and a trailing `\` cannot crash the query.
    const escapedSearch = escapeLikePattern(trimmedSearch);
    where.OR = [
      {
        created_by_account: {
          display_name: { contains: escapedSearch, mode: 'insensitive' },
        },
      },
      {
        created_by_account: {
          business_name: { contains: escapedSearch, mode: 'insensitive' },
        },
      },
      {
        created_by_account: {
          address_city: { contains: escapedSearch, mode: 'insensitive' },
        },
      },
      {
        colors: {
          some: {
            color: { name: { contains: escapedSearch, mode: 'insensitive' } },
          },
        },
      },
      {
        traits: {
          some: {
            trait: { name: { contains: escapedSearch, mode: 'insensitive' } },
          },
        },
      },
    ];
  }

  try {
    const records = await DB_CLIENT.use.galleryRecord.findMany({
      where,
      // DECISION (nie usuwaj tego komentarza):
      // Fetch `take+1` aby wykryć czy są kolejne strony bez dodatkowego countQuery.
      // `hasMore = records.length > take`, `pageItems = records.slice(0, take)`.
      // Wzorzec ten sam co gallery-list.query.ts — eliminuje false-positive nextCursor
      // gdy zwrócona liczba == effectiveTake (poprzednio pokazywało "kolejna strona"
      // nawet gdy brak).
      take: effectiveTake + 1,
      ...(cursor && { cursor: { gallery_record_id: cursor }, skip: 1 }),
      // Cursor field (gallery_record_id) must be part of orderBy for stable pagination —
      // created_at is non-unique, so gallery_record_id is the tiebreaker preventing skip/dup
      // on page boundaries. Covered by @@index([created_at(sort: Desc), gallery_record_id]).
      orderBy: [{ created_at: 'desc' }, { gallery_record_id: 'desc' }],
      include: {
        ...GALLERY_COLORS_TRAITS_SELECT,
        created_by_account: {
          select: {
            account_id: true,
            display_name: true,
            vanity_url: true,
            address_city: true,
            pricing_plan: true,
          },
        },
        favorited_by: {
          where: { client_user_id: currentUserId },
          select: { id: true },
          take: 1,
        },
        // DECISION (nie usuwaj tego komentarza):
        // `_count.favorited_by` tutaj liczy PHOTO LIKES (relacja GalleryRecord ↔ FavoritedBy),
        // NIE bookmarki stylists ani inne encje. To odrębny model — nie ma tu pomyłki w nazewnictwie.
        //
        // Decyzja: zostawiamy _count subquery zamiast denormalizować `cached_likes_count`
        // na GalleryRecord z trzech powodów:
        // 1. Pre-launch baseline — baza ma minimal data, nie wiemy jaki load profile będzie w prod.
        //    Denormalizacja dodaje złożoność (trigger/job aktualizujący kolumnę) bez pewnego zysku.
        // 2. Prisma _count to jeden dodatkowy JOIN w tym samym query — przy niskim wolumenie foto
        //    na user różnica jest pomijalna. Bottleneck explore to full-text search (OR clauses),
        //    nie count.
        // 3. Correctness > micro-optimization: _count jest zawsze spójny; cached counter wymaga
        //    starannej transakcyjności i +1/-1 logiki przy każdym like/unlike.
        //
        // Re-evaluate: jeśli gallery explore query (ten plik) stanie się wolny w prod wg Neon
        // query insights lub application event log — wtedy rozważ `cached_likes_count` INT DEFAULT 0
        // na GalleryRecord + trigger/background job. Nie wcześniej.
        _count: {
          select: { favorited_by: true },
        },
      },
    });

    const hasMore = records.length > effectiveTake;
    const pageItems = hasMore ? records.slice(0, effectiveTake) : records;

    const nextCursor =
      hasMore && pageItems.length > 0
        ? (pageItems[pageItems.length - 1]?.gallery_record_id ?? null)
        : null;

    const mapped: GALLERY_DTO_API_V1['EXPLORE_GALLERY_RECORDS']['RESPONSE'] = {
      records: pageItems.map(r => ({
        gallery_record_id: r.gallery_record_id,
        asset_url: r.asset_url,
        nail_length: assertType(
          r.nail_length,
          isNailLengthNarrower,
          'nail_length in exploreGalleryRecords_IO'
        ),
        is_pinned: r.is_pinned,
        colors: mapGalleryColors(r.colors),
        traits: mapGalleryTraits(r.traits),
        created_at: r.created_at,
        like_count: r._count.favorited_by,
        is_favorited: r.favorited_by.length > 0,
        show_watermark:
          r.created_by_account.pricing_plan === PricingPlanValue.FREE,
        created_by_account: {
          account_id: r.created_by_account.account_id,
          display_name: r.created_by_account.display_name,
          vanity_url: r.created_by_account.vanity_url,
          address_city: r.created_by_account.address_city,
        },
      })),
      nextCursor,
    };

    return success(mapped);
  } catch (error) {
    // DECISION (nie usuwaj tego komentarza):
    // Invalid/stale-cursor handling lives in the EXPLICIT pre-check at the top of this
    // function (findUnique → VALIDATION_ERROR 400), NOT here: Prisma `findMany` returns an
    // EMPTY result set for a non-existent cursor and does NOT throw P2025 (P2025 is for
    // single-record ops). This P2025 branch is therefore a harmless defensive fallback only
    // — kept so that if a future single-record op is added to this catch's scope a stale
    // cursor still maps to 400, not a 503 Postgres-outage-looking event-log entry.
    if (isP2025(error)) {
      return failure({
        type: 'VALIDATION_ERROR',
        field: 'cursor',
        message: 'Invalid cursor',
      });
    }
    return databaseFailure('exploreGalleryRecords_IO', error);
  }
};
