import { DB_CLIENT } from '@app/db/db.client';
import { escapeLikePattern } from '@app/db/like-escape';
import { databaseFailure } from '@app/errors/error-result.helpers';
import type { PUBLIC_DTO_API_V1 } from '@kernel/models/public/public.dto';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  DatabaseError,
  ValidationError,
} from '@kernel/application/common-errors.types';
import { isP2025 } from '@app/db/prisma-error';
import { isValidCursorFormat } from '@kernel/policies/validation/validation.utils';
import { STYLIST_PUBLICLY_VISIBLE } from '@domain/account/account.config';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import {
  PRICING_POLICY,
  narrowPricingPlan,
} from '@kernel/policies/pricing.policy';
import type { Prisma } from '../../../prisma/js-client';
import { countPublicGalleryRecordsByAccount } from '@domain/gallery/public-gallery-count';

/**
 * Cursor-paginated list of public stylists for "Stylistki" tab in Favorites/Explore.
 *
 * SECURITY (PUBLIC endpoint):
 * - No userId/auth required.
 * - Returns ONLY public-safe fields: display_name, avatar, city, instagram, bookmark/photo counts, pricing tier flag.
 * - DOES NOT leak email, phone, address (street/postal), description, latitude/longitude, business_name.
 * - Filters: only ACTIVE accounts (account_status === 'ACTIVE') and active users (is_active === true).
 *
 * Performance:
 * - cursor-based pagination via account_id (cuid, ordered by created_at DESC).
 * - take is capped (max 50).
 * - city filter uses @@index([address_city]) (added in 2_add_index_stylist_city migration).
 * - searchQuery uses ILIKE (mode: 'insensitive') over display_name + business_name + address_city.
 *   For PRO-grade fuzzy matching, consider PostgreSQL pg_trgm/GIN index later.
 */
export const getPublicStylistsList_IO = async ({
  cursor,
  take = 20,
  city,
  searchQuery,
}: {
  cursor?: string;
  take?: number;
  city?: string;
  searchQuery?: string;
}): Promise<
  OperationResult<
    PUBLIC_DTO_API_V1['GET_PUBLIC_STYLISTS_LIST']['RESPONSE'],
    DatabaseError | ValidationError
  >
> => {
  const effectiveTake = Math.min(take, 50);

  // Trim search query — empty after trim = ignore filter
  const trimmedSearch =
    typeof searchQuery === 'string' ? searchQuery.trim() : '';
  const trimmedCity = typeof city === 'string' ? city.trim() : '';

  // Spread the shared public-visibility invariant (STYLIST_PUBLICLY_VISIBLE) into a local copy
  // so the optional city/search predicates below mutate `where`, never the shared const.
  const where: Prisma.StylistAccountWhereInput = {
    ...STYLIST_PUBLICLY_VISIBLE,
  };

  if (trimmedCity.length > 0) {
    // Case-insensitive equality on city (uses @@index([address_city]) — Postgres planner
    // can still use the B-tree for ILIKE equality patterns w/o leading wildcards).
    // escapeLikePattern: `equals` + mode:'insensitive' compiles to ILIKE; an unescaped
    // city ending in `\` (e.g. `%\`) crashed the query with an unmapped 500 on this PUBLIC
    // endpoint (finding WF-CITY-500). See like-escape.ts.
    where.address_city = {
      equals: escapeLikePattern(trimmedCity),
      mode: 'insensitive',
    };
  }

  if (trimmedSearch.length > 0) {
    // Fuzzy text search across public-safe fields.
    // Note: 'business_name' is publicly visible on profile pages; description is excluded
    // from search to avoid full-text scans of long text fields.
    // Escape LIKE metacharacters so `%`/`_` match literally and a trailing `\` cannot 500.
    const escapedSearch = escapeLikePattern(trimmedSearch);
    where.OR = [
      { display_name: { contains: escapedSearch, mode: 'insensitive' } },
      { business_name: { contains: escapedSearch, mode: 'insensitive' } },
      { address_city: { contains: escapedSearch, mode: 'insensitive' } },
    ];
  }

  // DECISION (nie usuwaj tego komentarza):
  // Uniform cursor contract — wzorzec z gallery-explore.query.ts. (1) Format-gate:
  // null-byte / non-cuid cursor rzucałby w Prisma → niezmapowany 500;
  // isValidCursorFormat (@kernel — SSOT) zwraca VALIDATION_ERROR 400. (2) Existence
  // pre-check na account_id (cursor === orderBy field): findMany dla stale cursora
  // zwraca PUSTY zbiór (NIE P2025), więc bez tego 200 + stylists:[] nieodróżnialne
  // od końca listy, łamiąc kontrakt 400 'Invalid cursor'. Sprawdzamy istnienie
  // wiersza po PK BEZ STYLIST_PUBLICLY_VISIBLE filtra — cursor to wewnętrzny token
  // paginacji (poprzednio zwrócone account_id), nie content-query; konto, które
  // później stało się ukryte/nieaktywne, jest wciąż poprawną kotwicą `skip:1`, więc
  // odrzucamy tylko cursory wskazujące na ŻADEN wiersz. P2025-branch w catch poniżej
  // zostaje jako nieszkodliwy fallback.
  if (cursor !== undefined) {
    if (!isValidCursorFormat(cursor)) {
      return failure({
        type: 'VALIDATION_ERROR',
        field: 'cursor',
        message: 'Invalid cursor',
      });
    }
    try {
      const cursorRow = await DB_CLIENT.use.stylistAccount.findUnique({
        where: { account_id: cursor },
        select: { account_id: true },
      });
      if (!cursorRow) {
        return failure({
          type: 'VALIDATION_ERROR',
          field: 'cursor',
          message: 'Invalid cursor',
        });
      }
    } catch (error) {
      return databaseFailure('getPublicStylistsList_IO:cursorCheck', error);
    }
  }

  try {
    // Fetch effectiveTake + 1 to detect if there are more pages
    const accounts = await DB_CLIENT.use.stylistAccount.findMany({
      where,
      take: effectiveTake + 1,
      ...(cursor && { cursor: { account_id: cursor }, skip: 1 }),
      // DECISION (nie usuwaj tego komentarza):
      // Cursor po account_id zamiast created_at — cuid jest time-ordered (k-sortable),
      // więc "DESC po account_id" zachowuje semantykę "najnowsze najpierw".
      // Wymagane: cursor field === orderBy field, inaczej Prisma cursor+skip:1 gubi/duplikuje rekordy.
      orderBy: { account_id: 'desc' },
      select: {
        account_id: true,
        display_name: true,
        avatar_url: true,
        // Own upload wins; the OAuth image is the fallback for accounts that never
        // set one (the UI falls further back to initials). The column HAS a write
        // path since 2026-09-09 (account/set-avatar) — it is no longer always null,
        // so do not "simplify" this back to reading created_by_user.image only.
        created_by_user: { select: { image: true } },
        address_city: true,
        instagram_handle: true,
        vanity_url: true,
        pricing_plan: true,
        brand_accent_color: true,
        // DECISION (nie usuwaj tego komentarza):
        // Denormalized counts replace _count: { select } subquery (D7+DD3-D1 run 24).
        // Maintained atomically in bookmarkStylist_IO / unbookmarkStylist_IO /
        // createGalleryRecord_IO / deleteGalleryRecord_IO / moderation DELETE path.
        // photo_count NIE jest z `cached_gallery_count` (wlicza prace ukryte przez
        // moderację) — patrz countPublicGalleryRecordsByAccount niżej.
        cached_bookmark_count: true,
      },
    });

    const hasMore = accounts.length > effectiveTake;
    const pageItems = hasMore ? accounts.slice(0, effectiveTake) : accounts;

    // photo_count = publiczny rozmiar portfolio (nieukryte prace, z bazy, nie z
    // cache) — jeden groupBy na stronę, bez N+1. DECISION w public-gallery-count.ts.
    const publicPhotoCounts =
      await countPublicGalleryRecordsByAccount(pageItems);

    const stylists: PUBLIC_DTO_API_V1['GET_PUBLIC_STYLISTS_LIST']['RESPONSE']['stylists'] =
      pageItems.map(a => {
        // is_pro_or_higher: paid plan (PRO or above). FREE = false.
        const isProOrHigher =
          a.pricing_plan === PricingPlanValue.PRO ||
          a.pricing_plan === PricingPlanValue.PRO_PLUS ||
          a.pricing_plan === PricingPlanValue.STUDIO ||
          a.pricing_plan === PricingPlanValue.SCALE;

        return {
          account_id: a.account_id,
          identifier: a.vanity_url ?? a.account_id,
          display_name: a.display_name,
          avatar_url: a.avatar_url ?? a.created_by_user?.image ?? null,
          city: a.address_city,
          instagram_handle: a.instagram_handle,
          bookmark_count: a.cached_bookmark_count,
          photo_count: publicPhotoCounts.get(a.account_id) ?? 0,
          is_pro_or_higher: isProOrHigher,
          // Branding-light krok 2: maska planu na read (jak profil/galeria S51).
          brand_accent_color: PRICING_POLICY.LIMITS[
            narrowPricingPlan(a.pricing_plan)
          ].can_brand_profile
            ? a.brand_accent_color
            : null,
        };
      });

    const nextCursor = hasMore
      ? (pageItems[pageItems.length - 1]?.account_id ?? null)
      : null;

    return success({ stylists, nextCursor });
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
    return databaseFailure('getPublicStylistsList_IO', error);
  }
};
