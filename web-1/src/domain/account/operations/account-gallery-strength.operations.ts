import { resolvePersonAvatarUrl } from '@kernel/domain/user/avatar.policy';
import { DB_CLIENT } from '@app/db/db.client';
import { databaseFailure } from '@app/errors/error-result.helpers';
import type { OperationResult } from '@kernel/application/result.types';
import { success } from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import { PairingStatusValue } from '@kernel/models/db_models.generated.dto';

// Building block of the dashboard feed (gallery_strength_score); no standalone endpoint, so the
// response shape stays local.
type GalleryStrengthResponse = {
  score: number;
  breakdown: {
    gallery_records: number;
    profile_completeness: number;
    has_active_pair: number;
    has_views: number;
  };
};

/**
 * Computes gallery strength score for a stylist account.
 * Reused by dashboard feed (gallery_strength_score field).
 */
export const computeGalleryStrength_IO = async (
  stylist_account_id: string,
  precomputed?: { galleryCount?: number; activePairCount?: number }
): Promise<OperationResult<GalleryStrengthResponse, DatabaseError>> => {
  try {
    const [account, galleryCount, activePairCount] = await Promise.all([
      DB_CLIENT.use.stylistAccount.findUnique({
        where: { account_id: stylist_account_id },
        select: {
          display_name: true,
          description: true,
          address_city: true,
          view_count: true,
          avatar_url: true,
          created_by_user: {
            select: { image: true, avatar_url: true },
          },
        },
      }),
      precomputed?.galleryCount !== undefined
        ? precomputed.galleryCount
        : // DECISION: the fallback counts visible records only (is_hidden:false), matching
          // cached_gallery_count; counting hidden ones would inflate the score past the public
          // count.
          DB_CLIENT.use.galleryRecord.count({
            where: {
              created_by_account_id: stylist_account_id,
              is_hidden: false,
            },
          }),
      precomputed?.activePairCount !== undefined
        ? precomputed.activePairCount
        : DB_CLIENT.use.clientStylistPair.count({
            where: {
              stylist_account_id,
              status: PairingStatusValue.ACTIVE,
            },
          }),
    ]);

    if (!account) {
      // Return zero score for non-existent account rather than error
      const emptyBreakdown: GalleryStrengthResponse = {
        score: 0,
        breakdown: {
          gallery_records: 0,
          profile_completeness: 0,
          has_active_pair: 0,
          has_views: 0,
        },
      };
      return success(emptyBreakdown);
    }

    // gallery_records: min(count * 15, 50) — max 50 pts for 4+ photos
    const galleryRecordsPts = Math.min(galleryCount * 15, 50);

    // profile_complete: has display_name (5) + has description/bio (5) + has city (5) + has profile_image_url (5) = max 20 pts
    let profilePts = 0;
    if (account.display_name) {
      profilePts += 5;
    }
    if (account.description) {
      profilePts += 5;
    }
    if (account.address_city) {
      profilePts += 5;
    }
    // Profile photo chain: own upload, then the OAuth image.
    // Counting only the OAuth image ignored avatar_url after that column got a
    // write path, so a magic-link stylist who uploaded a photo scored as if
    // the photo was missing.
    if (resolvePersonAvatarUrl(account.created_by_user ?? {})) {
      profilePts += 5;
    }

    // has_any_active_pair: 10 pts
    const activePairPts = activePairCount > 0 ? 10 : 0;

    // view_count > 0: 10 pts
    // DD2-H8 r28: defensive nullish coalesce — schema today is non-nullable,
    // but Prisma aggregate types stay `number | null` (latent fragility).
    const hasViewsPts = (account.view_count ?? 0) > 0 ? 10 : 0;

    const rawScore =
      galleryRecordsPts + profilePts + activePairPts + hasViewsPts;
    const score = Math.min(rawScore, 100);

    return success({
      score,
      breakdown: {
        gallery_records: galleryRecordsPts,
        profile_completeness: profilePts,
        has_active_pair: activePairPts,
        has_views: hasViewsPts,
      },
    });
  } catch (error) {
    return databaseFailure('computeGalleryStrength', error);
  }
};

/**
 * Zapisuje decyzję stylistki o zamknięciu karty „Siła galerii".
 *
 * DECISION: the dismissal flag is one-way and nothing clears it. The SCORE decides: below 100%
 * the front shows the card despite the flag. Clearing the column on a drop would look the same
 * on screen but erase the one fact the score cannot rebuild (owner).
 */
export const dismissGalleryStrength_IO = async (
  stylist_account_id: string
): Promise<
  OperationResult<
    { account_id: string; gallery_strength_dismissed_at: string },
    DatabaseError
  >
> => {
  try {
    const dismissedAt = new Date();
    const updated = await DB_CLIENT.use.stylistAccount.update({
      where: { account_id: stylist_account_id },
      data: { gallery_strength_dismissed_at: dismissedAt },
      select: { account_id: true },
    });

    return success({
      account_id: updated.account_id,
      // The column is nullable, but this write just set it.
      gallery_strength_dismissed_at: dismissedAt.toISOString(),
    });
  } catch (error) {
    return databaseFailure('dismissGalleryStrength', error);
  }
};
