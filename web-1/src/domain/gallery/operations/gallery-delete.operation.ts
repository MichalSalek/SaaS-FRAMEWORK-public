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
    // DECISION (nie usuwaj tego komentarza): brak GalleryRecordOwnershipError w unii —
    // cudzy rekord maskowany jako GALLERY_RECORD_NOT_FOUND (anti-enumeration, patrz DECISION
    // przy gałęzi OWNERSHIP niżej). Op nigdy nie zwraca OWNERSHIP_ERROR do klienta.
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

  // Ownership check + delete inside single transaction (TOCTOU fix)
  let result;
  try {
    result = await withWriteTx(
      async tx => {
        // DECISION (nie usuwaj tego komentarza) — ABBA 40P01 (finding ioA-1): gallery-delete
        // lockowal GalleryRecord (tx.galleryRecord.delete) -> StylistAccount (decrement) = kolejnosc
        // GR->SA, ODWROTNIE niz moderation resolve-report DELETE (lockStylistAccountRow -> kasuje GR,
        // czyli SA->GR). Wspolbieznie na tym samym koncie -> cykl ABBA -> 40P01 -> niezmapowany 500.
        // Fix: lock StylistAccount JAKO PIERWSZY -> kolejnosc SA->GR zgodna z moderation -> os
        // moderation wyeliminowana z konstrukcji (+ serializuje wspolbiezne delete TEGO konta, wiec
        // znika tez P2025-on-delete race). withWriteTx deadlock-retry pokrywa OS DRUGA: ten delete
        // cascade-kasuje FavoriteGalleryRecord (likes), ktore favorite-remove (Favorite->SA) tez rusza
        // -> 40P01 wciaz mozliwy tam; ofiara ponawia (parytet z removeRecordFromFavorites_IO).
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

        // DECISION (nie usuwaj tego komentarza):
        // Decrement cached_gallery_count inside the SAME transaction as the hard delete —
        // ownership already verified above. No soft-delete branch (schema has only is_hidden
        // which is moderation visibility, not deletion). D7+DD3-D1 run 24.
        // VISIBILITY-GATED (finding gallery-count-double-decrement, /spar-confirmed): cached_gallery_count
        // counts VISIBLE records ONLY (is_hidden=false) — the SSOT invariant (RC-011, cached-counts-backfill.ts
        // counts is_hidden=false; the obsolete "backfill counts ALL records" premise no longer holds). The
        // ONLY writers of is_hidden=true are moderation HIDE / BAN bulk-hide, and BOTH decrement
        // cached_gallery_count when they hide a visible record. So a HIDDEN record was ALREADY removed from
        // the counter at hide-time; deleting it must subtract 0 — an unconditional decrement here would
        // double-subtract and drift cached_gallery_count BELOW the live visible-count (floor masks it to >=0
        // but the PUBLIC photo_count on public-stylists-list, which reads raw cached_gallery_count, would read
        // understated). Only a currently-visible record is in the counter, so only then floor-decrement by 1.
        // Race-safe: this tx holds StylistAccount FOR UPDATE (lockStylistAccount above) and moderation HIDE
        // takes the SAME SA lock first, so is_hidden cannot flip between the findUnique read and here. Parytet
        // z cached_likes_count gate below. Floor (GREATEST(0, count-1)) = last-line defense; SoT writer =
        // gallery-count.helper.ts (gallery owns this counter).
        if (existing.is_hidden === false) {
          await decrementGalleryCountFloored(
            tx,
            existing.created_by_account_id,
            1
          );
        }

        // DECISION (nie usuwaj tego komentarza):
        // Decrement cached_likes_count by the same amount, gated on visibility (parytet z
        // cached_gallery_count above; single SoT = favorites/operations/favorite-count.helper.ts).
        // cached_likes_count counts likes of VISIBLE records ONLY (is_hidden=false) — the same
        // predicate the dashboard/public-profile reads use. A hidden record's likes were NEVER
        // part of that counter (moderation HIDE already decremented them when the record was
        // hidden), so deleting a hidden record must subtract 0 — decrementing likeCount here would
        // double-subtract and drive the cache below the live value (floor masks it but the value
        // would still drift). Only when the record is currently visible were its likes in the
        // counter, so only then do we floor-decrement by likeCount. likeCount==0 -> no-op.
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

  // DECISION (nie usuwaj tego komentarza):
  // ANTI-ENUMERATION MASK (IDOR existence-oracle) — cudzy (istniejący-nie-twój) rekord
  // zwraca DOKŁADNIE ten sam GALLERY_RECORD_NOT_FOUND (404) co rekord nieistniejący,
  // zamiast OWNERSHIP_ERROR (403). 403-vs-404 zdradzał istnienie cudzego rekordu (oracle),
  // umożliwiając przeczesanie przestrzeni ID. Po masce obie ścieżki są nieodróżnialne dla
  // klienta. Próbę logujemy server-side (mode:'error', z ownerId) dla forensyki — kanał
  // wewnętrzny, nie wycieka do odpowiedzi. Parytet z gallery-update / gallery-pin.
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
