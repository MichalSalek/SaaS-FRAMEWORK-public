import {
  personAvatarSources,
  resolvePersonAvatarUrl,
} from '@kernel/domain/user/avatar.policy';
import { resolveEffectivePlans_IO } from '@app/pricing/effective-plan.resolver';
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
import { fetchPublicSamplePhotos } from '@domain/gallery/public-sample-photos';
import { VISIBLE_PINNED_GALLERY_RECORD_WHERE } from '@domain/gallery/gallery-record-visibility';

/**
 * Cursor-paginated public stylist list. No auth. Returns only public fields
 * (name, avatar, city, instagram, counts, plan flag) for ACTIVE accounts with an
 * active user. Email, phone, street, description, coordinates and business name
 * stay out. Cursor is account_id ordered by created_at DESC, take capped at 50.
 * City uses the city index. Search is case-insensitive ILIKE on name, business name and city.
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
  // DECISION: the list is a discovery surface, so it shows only stylists with at least one work a stranger may see
  // (pinned and not hidden, the public profile's rule). Newest-first put empty, just-created accounts at the top,
  // each card saying "Brak opublikowanych prac". A client connects to her own stylist by QR, not here.
  const where: Prisma.StylistAccountWhereInput = {
    ...STYLIST_PUBLICLY_VISIBLE,
    gallery_record: { some: VISIBLE_PINNED_GALLERY_RECORD_WHERE },
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

  // DECISION: uniform cursor contract (pattern of gallery-explore.query.ts). (1) Format gate: a null byte or non-cuid
  // cursor would throw in Prisma as an unmapped 500; isValidCursorFormat (@kernel) returns VALIDATION_ERROR 400. (2)
  // Existence pre-check on account_id (cursor === the orderBy field): findMany for a stale cursor returns an EMPTY set
  // (no P2025), so without it 200 + stylists:[] is indistinguishable from the end of the list, breaking the 400
  // 'Invalid cursor' contract. The PK lookup runs WITHOUT the STYLIST_PUBLICLY_VISIBLE filter: the cursor is an internal
  // pagination token (a previously returned account_id), and an account that later became hidden or inactive is still a
  // valid `skip:1` anchor, so only cursors pointing at NO row are rejected. The P2025 branch in the catch below stays as a
  // harmless fallback.
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
      // DECISION: the cursor is account_id instead of created_at: cuid is time-ordered (k-sortable), so "DESC by
      // account_id" keeps newest-first. The cursor field MUST equal the orderBy field, or Prisma cursor+skip:1 loses or
      // duplicates records.
      orderBy: { account_id: 'desc' },
      select: {
        account_id: true,
        display_name: true,
        avatar_url: true,
        // Own upload wins; the OAuth image is the fallback for accounts that never
        // set one (the UI falls further back to initials). The column HAS a write
        // path since 2026-09-09 (account/set-avatar) — it is no longer always null,
        // so do not "simplify" this back to reading created_by_user.image only.
        created_by_user: { select: { image: true, avatar_url: true } },
        address_city: true,
        instagram_handle: true,
        vanity_url: true,
        pricing_plan: true,
        created_by_user_id: true,
        brand_accent_color: true,
        // DECISION: denormalized counts replace a `_count: { select }` subquery. They are maintained atomically in
        // bookmarkStylist_IO / unbookmarkStylist_IO / createGalleryRecord_IO / deleteGalleryRecord_IO / the moderation
        // DELETE path. photo_count does NOT read `cached_gallery_count`; it is counted exactly from the DB, see
        // countPublicGalleryRecordsByAccount below.
        cached_bookmark_count: true,
      },
    });

    const hasMore = accounts.length > effectiveTake;
    const pageItems = hasMore ? accounts.slice(0, effectiveTake) : accounts;

    // photo_count = the public portfolio size (non-hidden works, from the DB, not the cache): one groupBy per page,
    // no N+1. Rationale: public-gallery-count.ts.
    const [publicPhotoCounts, samplePhotos] = await Promise.all([
      countPublicGalleryRecordsByAccount(pageItems),
      fetchPublicSamplePhotos(pageItems.map(a => a.account_id)),
    ]);

    const effectivePlans = await resolveEffectivePlans_IO(
      pageItems.map(a => ({
        userId: a.created_by_user_id,
        ownPlan: a.pricing_plan,
      }))
    );
    const stylists: PUBLIC_DTO_API_V1['GET_PUBLIC_STYLISTS_LIST']['RESPONSE']['stylists'] =
      pageItems.map(a => {
        const plan =
          effectivePlans.get(a.created_by_user_id)?.effective_pricing_plan ??
          a.pricing_plan;
        // is_pro_or_higher: paid plan (PRO or above). FREE = false.
        const isProOrHigher =
          plan === PricingPlanValue.PRO ||
          plan === PricingPlanValue.PRO_PLUS ||
          plan === PricingPlanValue.STUDIO ||
          plan === PricingPlanValue.SCALE;

        return {
          account_id: a.account_id,
          identifier: a.vanity_url ?? a.account_id,
          display_name: a.display_name,
          avatar_url: resolvePersonAvatarUrl(a.created_by_user ?? {}),
          avatar_fallback_url:
            personAvatarSources(a.created_by_user ?? {})[1] ?? null,
          city: a.address_city,
          instagram_handle: a.instagram_handle,
          bookmark_count: a.cached_bookmark_count,
          photo_count: publicPhotoCounts.get(a.account_id) ?? 0,
          sample_photo_urls: samplePhotos.get(a.account_id) ?? [],
          is_pro_or_higher: isProOrHigher,
          // Plan mask on read, the same as profile and gallery.
          brand_accent_color: PRICING_POLICY.LIMITS[narrowPricingPlan(plan)]
            .can_brand_profile
            ? a.brand_accent_color
            : null,
        };
      });

    const nextCursor = hasMore
      ? (pageItems[pageItems.length - 1]?.account_id ?? null)
      : null;

    return success({ stylists, nextCursor });
  } catch (error) {
    // DECISION: stale-cursor handling lives in the pre-check at the top of this function; this
    // P2025 branch is only a defensive fallback (see
    // web-1/src/domain/gallery/operations/gallery-explore.query.ts).
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
