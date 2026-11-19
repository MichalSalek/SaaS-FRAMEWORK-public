import { withWriteTx } from '@app/db/with-write-tx';
import { lockStylistAccount } from '@app/db/lock-rows';
import { isDeadlock } from '@app/db/prisma-error';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { databaseFailure } from '@app/errors/error-result.helpers';
import type { IDType } from '@kernel/application/application.types';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type { GalleryRecordNotFoundError } from '@kernel/domain/gallery/gallery-errors.types';
import type {
  ValidationError,
  DatabaseError,
} from '@kernel/application/common-errors.types';
import { cleanupCloudinaryAsset } from './gallery-cloudinary-cleanup';
import { decrementGalleryCountFloored } from './gallery-count.helper';
import { decrementLikeCountFloored } from '@domain/favorites/operations/favorite-count.helper';

/**
 * Delete a gallery record
 */
export const deleteGalleryRecord_IO = async ({
  gallery_record_id,
  id,
  account_id,
}: {
  gallery_record_id: IDType;
  id: IDType;
  account_id: IDType;
}): Promise<
  OperationResult<
    { deleted: true },
    // DECISION: the error union has no GalleryRecordOwnershipError: a foreign record is masked as
    // GALLERY_RECORD_NOT_FOUND (see the ownership branch below), so the op never returns OWNERSHIP_ERROR.
    GalleryRecordNotFoundError | ValidationError | DatabaseError
  >
> => {
  if (!gallery_record_id || !account_id) {
    reportIssueBackend({
      namespace: 'deleteGalleryRecord_IO',
      message: `Missing params. id: ${gallery_record_id}, account: ${account_id}`,
      payload: { gallery_record_id, account_id },
      mode: 'error',
    });
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'gallery_record_id',
      message: 'Missing required params',
    });
  }

  // Read ownership and delete in one write transaction, after lockStylistAccount.
  // The delete predicate is the record id. tests/concurrency/gallery-delete-moderation.concurrency.ts
  // covers delete versus hide on one account (no 500, counts, no 40P01), not an
  // ownership change between this read and the delete.
  let result;
  try {
    result = await withWriteTx(
      async tx => {
        // DECISION: lockStylistAccount is taken FIRST. Locking GalleryRecord (delete) then StylistAccount
        // (decrement) was the reverse of moderation resolve-report DELETE (SA -> GR), a concurrent ABBA that
        // ended as an unmapped 500 (40P01). SA-first matches moderation and also serializes concurrent
        // deletes on the account. withWriteTx deadlock-retry covers the second axis: this delete cascades to
        // FavoriteGalleryRecord, which favorite-remove (Favorite -> SA) also touches, so 40P01 stays possible
        // there and the victim retries (same as removeRecordFromFavorites_IO).
        await lockStylistAccount(tx, account_id);

        const existing = await tx.galleryRecord.findUnique({
          where: { gallery_record_id },
          select: {
            created_by_account_id: true,
            asset_url: true,
            is_hidden: true,
          },
        });

        if (!existing) {
          return { error: 'NOT_FOUND' as const, assetUrl: null };
        }

        if (existing.created_by_account_id !== account_id) {
          return {
            error: 'OWNERSHIP' as const,
            ownerId: existing.created_by_account_id,
            assetUrl: null,
          };
        }

        // Count the likes BEFORE the delete: FavoriteGalleryRecord.gallery_record_id has
        // onDelete: Cascade, so the junction rows vanish atomically with the record below —
        // after delete() this count would always read 0. We need the pre-delete tally to know
        // by how much to floor-decrement the owner's cached_likes_count.
        const likeCount = await tx.favoriteGalleryRecord.count({
          where: { gallery_record_id },
        });

        // Junction records cascade-delete via schema onDelete: Cascade
        await tx.galleryRecord.delete({
          where: { gallery_record_id },
        });

        // DECISION: cached_gallery_count is decremented in the SAME transaction as the hard delete (there
        // is no soft-delete: is_hidden is moderation visibility). The decrement is visibility-gated: the counter
        // holds VISIBLE records only (is_hidden=false, same as cached-counts-backfill.ts), and moderation
        // HIDE/BAN already decremented when they hid the record. Deleting a hidden record must therefore
        // subtract 0, or the counter would drift below the live visible count and the public photo_count
        // (raw cached_gallery_count in public-stylists-list) would read understated. Race-safe: this tx holds
        // the StylistAccount lock and moderation HIDE takes the same lock first, so is_hidden cannot flip
        // between the read and here. Writer: gallery-count.helper.ts, with its GREATEST(0, ...) floor.
        if (existing.is_hidden === false) {
          await decrementGalleryCountFloored(
            tx,
            existing.created_by_account_id,
            1
          );
        }

        // DECISION: cached_likes_count is decremented by likeCount under the same visibility gate as above
        // (single writer: favorites/operations/favorite-count.helper.ts). The counter holds likes of VISIBLE
        // records only; moderation HIDE already subtracted a hidden record's likes, so deleting a hidden
        // record must subtract 0 or the cache drifts below the live value. likeCount==0 is a no-op.
        if (existing.is_hidden === false && likeCount > 0) {
          await decrementLikeCountFloored(
            tx,
            existing.created_by_account_id,
            likeCount
          );
        }

        return { error: null as null, assetUrl: existing.asset_url };
      },
      { retryOn: isDeadlock }
    );
  } catch (error) {
    return databaseFailure('deleteGalleryRecord', error);
  }

  // DECISION: anti-enumeration mask (404 for a foreign record, never 403): see
  // web-1/src/domain/gallery/operations/gallery-update.operation.ts.
  if (result.error === 'OWNERSHIP') {
    reportIssueBackend({
      namespace: 'deleteGalleryRecord_IO',
      message: `Unauthorized delete attempt (masked as 404). Owner: ${result.ownerId}, Requester: ${account_id}`,
      payload: { gallery_record_id, id },
      mode: 'error',
    });
  }

  if (result.error === 'NOT_FOUND' || result.error === 'OWNERSHIP') {
    return failure({
      type: 'GALLERY_RECORD_NOT_FOUND',
      recordId: gallery_record_id,
    });
  }

  if (result.assetUrl) {
    cleanupCloudinaryAsset(result.assetUrl);
  }

  reportIssueBackend({
    namespace: 'deleteGalleryRecord_IO',
    message: `Gallery record deleted successfully: ${gallery_record_id}`,
    payload: { gallery_record_id, id },
    mode: 'info',
  });

  return success({ deleted: true });
};
