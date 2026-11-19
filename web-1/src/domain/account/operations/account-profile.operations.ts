import {
  personAvatarSources,
  resolvePersonAvatarUrl,
} from '@kernel/domain/user/avatar.policy';
import { resolveEffectivePlan_IO } from '@app/pricing/effective-plan.resolver';
import { getStylistSalonLink_IO } from '@domain/salon-profile/salon-profile.operations';
import { DB_CLIENT } from '@app/db/db.client';
import { isP2025 } from '@app/db/prisma-error';
import { databaseFailure } from '@app/errors/error-result.helpers';
import type { ACCOUNT_DTO_API_V1 } from '@kernel/models/account/account.dto';
import { PRICING_POLICY } from '@kernel/policies/pricing.policy';
import { sanitizeExternalLinks } from '@kernel/domain/user-and-account/external-links.config';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  AccountNotFoundError,
  DatabaseError,
} from '@kernel/application/common-errors.types';
import { shouldCountProfileView } from '@domain/account/profile-view-dedup';
import {
  STYLIST_PUBLICLY_VISIBLE,
  isAccountActive,
} from '@domain/account/account.config';
import { countPublicGalleryRecords } from '@domain/gallery/public-gallery-count';
import { fetchPublicSamplePhotos } from '@domain/gallery/public-sample-photos';

// DECISION: coordinates are geocoded from the FULL address (often a home), so this anonymous,
// crawlable response rounds them to 2 decimals (~1 km): enough for a NailSalon `geo`, too coarse
// to find a door. Stricter than the logged-in map search (COORD_PRECISION_DP = 3 in
// account-query.operations). Do not raise it without a privacy review; the DB keeps full precision.
const PUBLIC_PROFILE_COORD_DP = 2;
const roundPublicCoord = (value: number | null): number | null => {
  if (value === null) {
    return null;
  }
  const factor = 10 ** PUBLIC_PROFILE_COORD_DP;
  return Math.round(value * factor) / factor;
};

export const getPublicStylistProfile_IO = async ({
  identifier,
}: {
  identifier: string;
}): Promise<
  OperationResult<
    ACCOUNT_DTO_API_V1['ACCOUNT_GET_PUBLIC_PROFILE']['RESPONSE'],
    AccountNotFoundError | DatabaseError
  >
> => {
  const accountSelect = {
    account_id: true,
    created_by_user_id: true,
    account_status: true,
    display_name: true,
    business_name: true,
    address_city: true,
    address_street: true,
    address_country: true,
    phone: true,
    website: true,
    description: true,
    vanity_url: true,
    view_count: true,
    instagram_handle: true,
    external_links: true,
    avatar_url: true,
    brand_accent_color: true,
    latitude: true,
    longitude: true,
    // pricing_plan is only for the branding mask below. It is not part of the response.
    pricing_plan: true,
    // Fallback chain (own upload → OAuth image → initials in the UI). The column has
    // a real write path since 2026-09-09 (account/set-avatar, SCHEMA_DECISIONS
    // stylistaccount-avatar) — both halves are live, so neither may be dropped: the
    // OAuth image still serves every account that never uploaded one, and clearing the
    // avatar is precisely a request to fall back to it.
    created_by_user: { select: { image: true, avatar_url: true } },
    // Denormalized counters instead of a _count subquery; bookmarks are kept by
    // favorites/operations/bookmark-count.helper.ts, likes by favorite-count.helper.ts.
    cached_bookmark_count: true,
    cached_likes_count: true,
  } as const;

  // DECISION: total_likes comes from `cached_likes_count`, never a live favorite count, so it equals
  // the dashboard's like_count (see account-dashboard.operations.ts). gallery_records_count IS
  // counted live from the DB; why is in domain/gallery/public-gallery-count.ts.
  try {
    // DECISION: the visibility pair (STYLIST_PUBLICLY_VISIBLE) is split here on purpose: is_active
    // filters in the where, account_status is checked in JS, so not-found and not-active both
    // collapse to one ACCOUNT_NOT_FOUND 404 (anti-enumeration).
    // DECISION: the account id wins over a vanity. A single `OR` query returned whichever row came
    // first, so a vanity equal to another stylist's account_id could take over her profile, share
    // link and printed QR. Id first, vanity only when no account has that id.
    const activeOwner = { created_by_user: { is_active: true } } as const;
    const account =
      (await DB_CLIENT.use.stylistAccount.findFirst({
        where: { account_id: identifier, ...activeOwner },
        select: accountSelect,
      })) ??
      (await DB_CLIENT.use.stylistAccount.findFirst({
        where: { vanity_url: identifier, ...activeOwner },
        select: accountSelect,
      }));

    if (!account || !isAccountActive(account.account_status)) {
      return failure({ type: 'ACCOUNT_NOT_FOUND', accountId: identifier });
    }

    // Work count = public portfolio size (non-hidden works, from the DB, not from cache);
    // the profile shows „Wyróżnione (N) + jeszcze M”; see the DECISION in
    // public-gallery-count.ts. Osobny count po indeksie, bo `identifier` bywa
    // vanity_url i account_id znamy dopiero po findFirst.
    const [galleryRecordsCount, pinnedPhotos] = await Promise.all([
      countPublicGalleryRecords(account),
      fetchPublicSamplePhotos([account.account_id]),
    ]);

    // total_likes: HIDE keeps the FavoriteGalleryRecord rows, but favorite-count.helper.ts
    // decrements cached_likes_count by the hidden likes, so the public number never reveals hidden
    // content.

    const effective = await resolveEffectivePlan_IO({
      userId: account.created_by_user_id,
      ownPlan: account.pricing_plan,
    });
    const salonLink = await getStylistSalonLink_IO({
      accountId: account.account_id,
      userId: account.created_by_user_id,
    });
    const publicAccount = {
      account_id: account.account_id,
      display_name: account.display_name,
      business_name: account.business_name,
      address_city: account.address_city,
      address_street: account.address_street,
      address_country: account.address_country,
      phone: account.phone,
      website: account.website,
      description: account.description,
      vanity_url: account.vanity_url,
      view_count: account.view_count,
      instagram_handle: account.instagram_handle,
      external_links: sanitizeExternalLinks(account.external_links),
      effective_pricing_plan: effective.effective_pricing_plan,
      avatar_url: resolvePersonAvatarUrl(account.created_by_user ?? {}),
      avatar_fallback_url:
        personAvatarSources(account.created_by_user ?? {})[1] ?? null,
      // Read-time plan mask. The write gate does not clear the column on downgrade,
      // so a Pro Marka value would still render on Pro or Free. The stored value
      // stays and comes back on re-upgrade.
      brand_accent_color: PRICING_POLICY.LIMITS[
        effective.effective_pricing_plan
      ].can_brand_profile
        ? account.brand_accent_color
        : null,
      // Both or neither: a half-geocoded pair is not a location.
      ...(account.latitude !== null && account.longitude !== null
        ? {
            latitude: roundPublicCoord(account.latitude),
            longitude: roundPublicCoord(account.longitude),
          }
        : { latitude: null, longitude: null }),
    };
    return success({
      salon_link: salonLink,
      account: publicAccount,
      gallery_records_count: galleryRecordsCount,
      pinned_photo_urls: pinnedPhotos.get(account.account_id) ?? [],
      bookmark_count: account.cached_bookmark_count,
      total_likes: account.cached_likes_count,
    });
  } catch (error) {
    return databaseFailure('getPublicStylistProfile_IO', error);
  }
};

export const incrementProfileView_IO = async ({
  stylist_account_id,
  client_ip,
  viewer_account_id,
}: {
  stylist_account_id: string;
  client_ip: string | null;
  viewer_account_id: string | null;
}): Promise<
  OperationResult<
    ACCOUNT_DTO_API_V1['ACCOUNT_INCREMENT_VIEW']['RESPONSE'],
    AccountNotFoundError | DatabaseError
  >
> => {
  try {
    // DECISION: increment-view enforces the full public-visibility pair (STYLIST_PUBLICLY_VISIBLE),
    // like the public profile. Otherwise it answered 200 for profiles that 404 (an existence oracle)
    // and inflated views on hidden ones. findUnique cannot combine the unique id with these filters,
    // hence findFirst/updateMany (count === 0 means not visible).
    const activePredicate = {
      account_id: stylist_account_id,
      ...STYLIST_PUBLICLY_VISIBLE,
    } as const;

    // Self-view exclusion: an owner viewing their own profile must not inflate the
    // count. Takes the same "read & return current count" branch as the dedup hit.
    const isSelfView =
      viewer_account_id !== null && viewer_account_id === stylist_account_id;

    // Dedup: same IP + same target within 24h counts as one view
    if (isSelfView || !shouldCountProfileView(client_ip, stylist_account_id)) {
      // Return current view_count without incrementing
      const current = await DB_CLIENT.use.stylistAccount.findFirst({
        where: activePredicate,
        select: { view_count: true },
      });

      if (!current) {
        return failure({
          type: 'ACCOUNT_NOT_FOUND',
          accountId: stylist_account_id,
        });
      }

      return success({ view_count: current.view_count });
    }

    const updated = await DB_CLIENT.use.stylistAccount.updateMany({
      where: activePredicate,
      data: { view_count: { increment: 1 } },
    });

    if (updated.count === 0) {
      return failure({
        type: 'ACCOUNT_NOT_FOUND',
        accountId: stylist_account_id,
      });
    }

    // updateMany does not return rows; read back the new count for the response.
    const refreshed = await DB_CLIENT.use.stylistAccount.findFirst({
      where: activePredicate,
      select: { view_count: true },
    });

    if (!refreshed) {
      // Raced into non-ACTIVE between update and read — treat as not found.
      return failure({
        type: 'ACCOUNT_NOT_FOUND',
        accountId: stylist_account_id,
      });
    }

    return success({ view_count: refreshed.view_count });
  } catch (error) {
    // Prisma P2025 = record not found
    if (isP2025(error)) {
      return failure({
        type: 'ACCOUNT_NOT_FOUND',
        accountId: stylist_account_id,
      });
    }
    return databaseFailure('incrementProfileView_IO', error);
  }
};
