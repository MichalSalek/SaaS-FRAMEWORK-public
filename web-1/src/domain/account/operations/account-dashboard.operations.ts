import { DB_CLIENT } from '@app/db/db.client';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { VISIBLE_PINNED_GALLERY_RECORD_WHERE } from '@domain/gallery/gallery-record-visibility';
import type { ACCOUNT_DTO_API_V1 } from '@kernel/models/account/account.dto';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  DatabaseError,
  StylistNotFoundError,
} from '@kernel/application/common-errors.types';
import {
  PairingStatusValue,
  SessionContainerLifecycleStateValue,
} from '@kernel/models/db_models.generated.dto';
import { computeGalleryStrength_IO } from './account-gallery-strength.operations';

// DECISION: like_count reads the denormalized `cached_likes_count`, not a live
// FavoriteGalleryRecord count (a full cross-relation scan for prolific stylists). Its only writer
// is favorites/operations/favorite-count.helper.ts and it counts likes on VISIBLE records
// (is_hidden:false), the same set as the public profile's total_likes, so dashboard and profile
// agree. Drift recovery: application/startup/cached-counts-backfill.ts (same predicate).

type DashboardFeedResponse =
  ACCOUNT_DTO_API_V1['ACCOUNT_GET_DASHBOARD_FEED']['RESPONSE'];

export const getDashboardFeed_IO = async ({
  stylist_account_id,
}: {
  stylist_account_id: string;
}): Promise<
  OperationResult<DashboardFeedResponse, DatabaseError | StylistNotFoundError>
> => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [
      recentGalleryRecords,
      activePairsCount,
      pendingSharesCount,
      stylistAccount,
      recentBookmarksCount,
      pinnedCount,
    ] = await Promise.all([
      // Recent gallery records (last 5)
      DB_CLIENT.use.galleryRecord.findMany({
        where: { created_by_account_id: stylist_account_id },
        orderBy: { created_at: 'desc' },
        take: 5,
        select: {
          gallery_record_id: true,
          asset_url: true,
          created_at: true,
        },
      }),
      // Active pairs count
      DB_CLIENT.use.clientStylistPair.count({
        where: {
          stylist_account_id,
          status: PairingStatusValue.ACTIVE,
        },
      }),
      // Pending shared sessions count (not expired)
      DB_CLIENT.use.sessionContainer.count({
        where: {
          stylist_account_id,
          lifecycle_state: SessionContainerLifecycleStateValue.SHARED,
          expires_at: { gt: new Date() },
        },
      }),
      // Total view_count + created_at + denormalized counts from StylistAccount
      DB_CLIENT.use.stylistAccount.findUnique({
        where: { account_id: stylist_account_id },
        select: {
          view_count: true,
          created_at: true,
          cached_gallery_count: true,
          cached_likes_count: true,
          gallery_strength_dismissed_at: true,
        },
      }),
      // Recent bookmarks count (last 30 days)
      DB_CLIENT.use.favoriteStylist.count({
        where: {
          stylist_account_id,
          created_at: { gte: thirtyDaysAgo },
        },
      }),
      // Pinned and visible works = what a client really sees on the profile. Same filter as the
      // public gallery endpoint (is_pinned + !is_hidden) so the tutorial and the public profile
      // cannot drift apart. Added to the existing Promise.all: one parallel query, not a round.
      DB_CLIENT.use.galleryRecord.count({
        where: {
          created_by_account_id: stylist_account_id,
          ...VISIBLE_PINNED_GALLERY_RECORD_WHERE,
        },
      }),
    ]);

    if (!stylistAccount) {
      return failure({
        type: 'STYLIST_NOT_FOUND',
        stylistAccountId: stylist_account_id,
      });
    }

    // photo_count = SSOT cached_gallery_count (dekrementowany przy HIDE/DELETE/BAN moderacji) —
    // ten sam licznik co publiczny profil (account-profile gallery_records_count) i lista publiczna.
    // DECISION: not a raw galleryRecord.count, which would include hidden records and drift from
    // the public count and from like_count (is_hidden:false).
    const photoCount = stylistAccount.cached_gallery_count;

    // DECISION: computeGalleryStrength_IO re-reads the StylistAccount row on purpose. `precomputed`
    // is reserved for the expensive COUNT aggregates; the second read is a ~1ms PK lookup, and
    // passing profile fields in would couple the dashboard to gallery-strength internals.
    const galleryStrengthResult = await computeGalleryStrength_IO(
      stylist_account_id,
      { galleryCount: photoCount, activePairCount: activePairsCount }
    );
    const galleryStrengthScore = galleryStrengthResult.success
      ? galleryStrengthResult.data.score
      : 0;

    return success({
      gallery_strength_score: galleryStrengthScore,
      // The front shows the card despite the flag when the score drops below 100%;
      // see the DECISION at dismissGalleryStrength_IO.
      gallery_strength_dismissed:
        stylistAccount.gallery_strength_dismissed_at !== null,
      total_views: stylistAccount.view_count ?? 0,
      active_pairs_count: activePairsCount,
      pending_shares_count: pendingSharesCount,
      recent_bookmarks_count: recentBookmarksCount,
      recent_gallery_records: recentGalleryRecords.map(record => ({
        gallery_record_id: record.gallery_record_id,
        image_url: record.asset_url,
        created_at: record.created_at.toISOString(),
      })),
      // Extended stats
      photo_count: photoCount,
      pinned_count: pinnedCount,
      // like_count = denormalized cached_likes_count (single owner: favorite-count.helper.ts).
      // Same is_hidden:false visible-likes SoT as the public profile total_likes; see the DECISION
      // at the top of the file. NOT a raw favoriteGalleryRecord.count (expensive + dual-SoT drift).
      like_count: stylistAccount.cached_likes_count,
      paired_client_count: activePairsCount,
      member_since: stylistAccount.created_at.toISOString(),
      profile_view_count: stylistAccount.view_count ?? 0,
    });
  } catch (error) {
    return databaseFailure('getDashboardFeed_IO', error);
  }
};
