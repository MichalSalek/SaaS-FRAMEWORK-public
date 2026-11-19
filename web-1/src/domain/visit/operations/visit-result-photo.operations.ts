import { DB_CLIENT } from '@app/db/db.client';
import { lockActivePair, lockVisitRecord } from '@app/db/lock-rows';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { findForeignAssetOwner } from '@domain/_shared/guards/cloudinary-asset.guard';
import { cleanupCloudinaryAssets } from '@domain/gallery/operations/gallery-cloudinary-cleanup';
import type { ValidationError } from '@kernel/application/common-errors.types';
import type { OperationResult } from '@kernel/application/result.types';
import { failure, success } from '@kernel/application/result.types';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import { VISIT_CONFIG } from '@kernel/domain/visit/visit.config';
import type { VisitResultPhotoDTO } from '@kernel/models/visit/visit.dto';
import {
  mapPhotoToDTO,
  requireActivePairingLocked_IO,
  requireVisitAccess_IO,
  type VisitAccessError,
} from './visit-common.operations';
import { extractPublicIdFromUrl } from '@app/cloudinary/cloudinary-url.utils';
import { clientPairAccessIsCurrent } from '@domain/pairing/pair-access-current';

class VisitPhotoLimitRollback extends Error {
  constructor() {
    super('Visit result photo limit reached');
  }
}

// The visit vanished between requireVisitAccess_IO (outside the tx) and the lock: a client cascade
// delete (User onDelete:Cascade) can win that window. Without this, inserting the child row with a dead
// FK gives P2003 and an opaque 500; it is mapped to a clean VISIT_NOT_FOUND (like the read/write gate).
class VisitGoneRollback extends Error {
  constructor() {
    super('Visit removed before result photo insert');
  }
}

// Pairing revoked (status->REVOKED) between the outer requireVisitAccess_IO check and the in-tx
// lock. lockActivePair returns null → we abort the insert and mirror the pairing failure
// (CLIENT_UNAUTHORIZED_ACCESS) instead of writing a photo to a just-revoked client.
class PairingRevokedRollback extends Error {
  constructor() {
    super('Pairing revoked before result photo insert');
  }
}

export const addVisitResultPhoto_IO = async ({
  stylist_account_id,
  stylist_pricing_plan,
  visit_id,
  asset_url,
}: {
  stylist_account_id: string;
  stylist_pricing_plan: PricingPlan;
  visit_id: string;
  asset_url: string;
}): Promise<
  OperationResult<VisitResultPhotoDTO, VisitAccessError | ValidationError>
> => {
  const access = await requireVisitAccess_IO({
    visit_id,
    stylist_account_id,
    stylist_pricing_plan,
  });
  if (!access.success) {
    return access;
  }

  // DECISION: `asset_url` comes FROM THE CLIENT and the validator checks only the Cloudinary domain
  // prefix, which is not enough: `public_id`, the key used to delete the file, is derived from the URL.
  // Without this gate any stylist could attach a URL taken from ANOTHER account's public gallery to her
  // visit, then "remove the photo" and delete someone else's cloud file (confirmed at runtime). A URL that
  // already belongs to another account (gallery or visit photos) is rejected. The second layer is the
  // reference-check at deletion (gallery-cloudinary-cleanup), since this gate does not protect rows that
  // predate it. The same URL within her OWN account passes: legitimate reuse of her own photo.
  const ownership = await findForeignAssetOwner(asset_url, stylist_account_id);
  if (ownership !== 'OWN') {
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'asset_url',
      message:
        ownership === 'FOREIGN'
          ? 'Asset URL belongs to another account'
          : 'Asset URL is not a recognized Cloudinary upload address',
    });
  }

  try {
    const photo = await DB_CLIENT.use.$transaction(async tx => {
      // DECISION: a pessimistic FOR UPDATE on the parent VisitRecord row serializes parallel writers of
      // this visit's photos. Without it `position = max(position)+1` gave two transactions the same
      // number => @@unique([visit_record_id, position]) P2002, failing part of a parallel batch upload
      // with an opaque 500. Count + position + create then run under the lock, so no retry is needed.
      // No test pins the parallel upload.
      //
      // Revoke barrier: lock the ACTIVE pair FIRST (ClientStylistPair BEFORE VisitRecord, lock-rows.ts,
      // never reverse), so a revoke committing after the outer requireVisitAccess_IO check aborts the
      // insert.
      const pairLocked = await lockActivePair(
        tx,
        access.data.client_user_id,
        stylist_account_id,
        { requireActiveClient: true }
      );
      const pair = pairLocked
        ? await tx.clientStylistPair.findUnique({
            where: { id: pairLocked.id },
            select: { salon_origin_account_id: true },
          })
        : null;
      if (
        !pair ||
        !(await clientPairAccessIsCurrent(
          pair,
          access.data.client_user_id,
          stylist_account_id,
          tx
        ))
      ) {
        throw new PairingRevokedRollback();
      }

      const locked = await lockVisitRecord(tx, visit_id);
      if (!locked) {
        throw new VisitGoneRollback();
      }

      // One aggregate returns BOTH the limit-check count and the max position in a
      // single round-trip under the row lock (was: separate count() + aggregate() on
      // the identical where) — shorter lock-hold, fewer serialized round-trips in the
      // hot insert path. Values are identical to the two-query form.
      const stats = await tx.visitResultPhoto.aggregate({
        where: { visit_record_id: visit_id },
        _count: true,
        _max: { position: true },
      });
      if (stats._count >= VISIT_CONFIG.RESULT_PHOTOS_MAX_PER_VISIT) {
        throw new VisitPhotoLimitRollback();
      }
      const nextPosition = (stats._max.position ?? -1) + 1;

      return tx.visitResultPhoto.create({
        data: {
          visit_record_id: visit_id,
          stylist_account_id,
          asset_url,
          // `public_id` is stored WITH the url: the file-ownership gate asks for it by index instead of
          // scanning the whole url column. `null` = the url could not be parsed; such a row stays on the
          // slower in-code comparison path and still protects its file (cloudinary-asset.guard.ts).
          public_id: extractPublicIdFromUrl(asset_url),
          position: nextPosition,
        },
      });
    });

    return success(mapPhotoToDTO(photo));
  } catch (error) {
    if (error instanceof VisitPhotoLimitRollback) {
      return failure({
        type: 'VALIDATION_ERROR',
        field: 'result_photos',
        message: 'Visit result photo limit reached',
      });
    }
    if (error instanceof VisitGoneRollback) {
      return failure({ type: 'VISIT_NOT_FOUND', visitId: visit_id });
    }
    if (error instanceof PairingRevokedRollback) {
      return failure({
        type: 'CLIENT_UNAUTHORIZED_ACCESS',
        clientId: access.data.client_user_id,
        stylistAccountId: stylist_account_id,
      });
    }
    return databaseFailure('addVisitResultPhoto_IO', error);
  }
};

// Collects the asset_url of every VisitResultPhoto tied to the user (as client OR stylist) for
// Cloudinary cleanup BEFORE account terminal-delete; otherwise the cascade removes the rows and the
// blobs are orphaned (parity with gallery-cleanup). Best-effort: an error returns [] because cleanup is
// fire-and-forget and must not block account deletion.
export const collectVisitResultPhotoUrlsForUser_IO = async (
  userId: string
): Promise<string[]> => {
  try {
    const photos = await DB_CLIENT.use.visitResultPhoto.findMany({
      where: {
        OR: [
          { visit_record: { client_user_id: userId } },
          { visit_record: { stylist_account: { created_by_user_id: userId } } },
        ],
      },
      select: { asset_url: true },
      take: 5000, // Safety cap — mirror gallery collection
    });
    return photos.map(p => p.asset_url);
  } catch (error) {
    // Stays best-effort (an empty list does not block account deletion) but not silent: otherwise the
    // blobs are orphaned in Cloudinary unnoticed.
    reportIssueBackend({
      namespace: 'visit-result-photo-cleanup',
      message: `Could not collect visit result photo URLs before account delete: ${userId}`,
      payload: {
        error: error instanceof Error ? error.message : String(error),
      },
      mode: 'warn',
    });
    return [];
  }
};

export const removeVisitResultPhoto_IO = async ({
  stylist_account_id,
  stylist_pricing_plan,
  visit_id,
  photo_id,
}: {
  stylist_account_id: string;
  stylist_pricing_plan: PricingPlan;
  visit_id: string;
  photo_id: string;
}): Promise<OperationResult<{ success: true }, VisitAccessError>> => {
  const access = await requireVisitAccess_IO({
    visit_id,
    stylist_account_id,
    stylist_pricing_plan,
    // Deletion returns no content, so the retention cutoff does not apply (see the DECISION at
    // the cutoff in visit-common.operations.ts).
    purpose: 'destructive',
  });
  if (!access.success) {
    return access;
  }

  try {
    // The blob is collected BEFORE the row is deleted, else the URL is lost and the photo is orphaned
    // in Cloudinary (parity with account terminal-delete). Cleanup is fire-and-forget AFTER a
    // successful transaction.
    let orphanedAssetUrl: string | null = null;

    // Revoke-race barrier: re-confirm ACTIVE pairing UNDER A ROW LOCK in the SAME tx as the
    // delete, so a revoke committing after the outer requireVisitAccess_IO check cannot mutate a
    // just-revoked client's visit photos.
    const outcome: OperationResult<{ success: true }, VisitAccessError> =
      await DB_CLIENT.use.$transaction(async tx => {
        const barrier = await requireActivePairingLocked_IO(
          tx,
          access.data.client_user_id,
          stylist_account_id
        );
        if (!barrier.success) {
          return barrier;
        }

        const photo = await tx.visitResultPhoto.findFirst({
          where: {
            id: photo_id,
            visit_record_id: visit_id,
            stylist_account_id,
          },
          select: { asset_url: true },
        });

        const result = await tx.visitResultPhoto.deleteMany({
          where: {
            id: photo_id,
            visit_record_id: visit_id,
            stylist_account_id,
          },
        });
        if (result.count === 0) {
          return failure({ type: 'VISIT_NOT_FOUND', visitId: visit_id });
        }
        orphanedAssetUrl = photo?.asset_url ?? null;
        return success({ success: true as const });
      });

    if (outcome.success && orphanedAssetUrl !== null) {
      cleanupCloudinaryAssets([orphanedAssetUrl]);
    }
    return outcome;
  } catch (error) {
    return databaseFailure('removeVisitResultPhoto_IO', error);
  }
};
