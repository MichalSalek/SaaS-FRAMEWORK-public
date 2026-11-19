import { resolveEffectivePlans_IO } from '@app/pricing/effective-plan.resolver';
import { DB_CLIENT } from '@app/db/db.client';
import { escapeLikePattern } from '@app/db/like-escape';
import { databaseFailure } from '@app/errors/error-result.helpers';
import type { IDType } from '@kernel/application/application.types';
import type { ContractHandlerResponse } from '@kernel/application/contracts/contract.types';
import type { GalleryContracts } from '@kernel/domain/gallery/gallery.contracts';

type GalleryHandlerData<K extends keyof GalleryContracts> =
  ContractHandlerResponse<GalleryContracts[K]>;
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
    GalleryHandlerData<'EXPLORE_GALLERY_RECORDS'>,
    DatabaseError | ValidationError
  >
> => {
  // Clamp both bounds, same as gallery-list.query.ts. take <= 0 from another
  // caller becomes 1 (a negative take would read from the end in Prisma).
  // The HTTP handler already clamps [1,50]; this keeps the sibling queries aligned.
  const effectiveTake = Math.min(Math.max(take, 1), 50);

  // DECISION: cursor existence is validated explicitly before findMany. Unlike findUnique/update/delete,
  // findMany with a non-existent cursor returns an EMPTY set and does NOT throw P2025, so a stale cursor
  // would silently produce 200 + records:[] + nextCursor:null, indistinguishable from the end of the list
  // and breaking the 400 "Invalid cursor" contract the frontend relies on. The lookup is a cheap PK read
  // WITHOUT the visibility filter on purpose: the cursor is an internal pagination token, and a row that
  // later became hidden or inactive is still a valid `skip:1` anchor, so only cursors pointing at NO row are rejected.
  if (cursor !== undefined) {
    // DECISION: the cursor format is gated BEFORE it reaches findUnique (isValidCursorFormat, kernel
    // validation.utils). A null byte or non-cuid cursor threw in the PG `text` comparison as an unmapped
    // 500; a malformed format gets the same 400 'Invalid cursor' as a stale cursor.
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
    // DECISION: Explore is PUBLIC PINNED ONLY (DOMAIN_SSOT §4.4, §4.1, §4.2: unpinned works are available
    // only after an ACTIVE pairing) (owner). Without the filter Explore returned unpinned records
    // (asset_url plus stylist PII) to every logged-in viewer, leaking pairing-gated content. Same
    // is_pinned:true as publicGetGalleryRecordsByAccount_IO in gallery-public.operations.ts.
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
  // DECISION: `contains` with mode:'insensitive' on Color.name / Trait.name (via junction) has no trigram
  // index on purpose: they are small controlled dictionaries (~15 and ~30 rows, not user-generated), so a
  // seq scan takes microseconds. If they ever become user-generated and grow to thousands, add
  // @@index([name(ops: raw('gin_trgm_ops'))], type: Gin) on Color/Trait.
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
      // DECISION: fetch `take+1` to detect further pages without a count query (`hasMore = records.length >
      // take`, `pageItems = records.slice(0, take)`), same as gallery-list.query.ts. It avoids a false
      // nextCursor when the returned count equals effectiveTake.
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
            created_by_user_id: true,
          },
        },
        favorited_by: {
          where: { client_user_id: currentUserId },
          select: { id: true },
          take: 1,
        },
        // DECISION: `_count.favorited_by` here counts PHOTO LIKES (GalleryRecord <-> FavoritedBy), not stylist
        // bookmarks. The _count subquery stays instead of a denormalized `cached_likes_count` on GalleryRecord:
        // the pre-launch load profile is unknown, _count is one extra JOIN that is negligible at low photo
        // volume (the explore bottleneck is the OR text search), and it is always consistent while a counter
        // needs careful +1/-1 transactionality. Re-evaluate only if this query is slow in production per Neon
        // query insights or the event log.
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

    const effectivePlans = await resolveEffectivePlans_IO(
      pageItems.map(r => ({
        userId: r.created_by_account.created_by_user_id,
        ownPlan: r.created_by_account.pricing_plan,
      }))
    );
    const mapped: GalleryHandlerData<'EXPLORE_GALLERY_RECORDS'> = {
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
          (effectivePlans.get(r.created_by_account.created_by_user_id)
            ?.effective_pricing_plan ?? r.created_by_account.pricing_plan) ===
          PricingPlanValue.FREE,
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
    // DECISION: stale-cursor handling lives in the explicit pre-check at the top of this function, not
    // here: findMany returns an empty set for a non-existent cursor and never throws P2025. This P2025
    // branch is only a defensive fallback, so a future single-record op in this catch's scope still maps
    // a stale cursor to 400 and not to a 503 that looks like a Postgres outage.
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
