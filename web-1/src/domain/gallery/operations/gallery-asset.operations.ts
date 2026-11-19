import { reportIssueBackend } from '@app/debugger/error-handler';
import { escapeLikePattern } from '@app/db/like-escape';
import type { IDType } from '@kernel/application/application.types';
import { cloudinary } from '@app/cloudinary/cloudinary.adapter';
import type { CloudinaryType } from '@app/cloudinary/cloudinary.types';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  DatabaseError,
  ExternalServiceError,
} from '@kernel/application/common-errors.types';
import type {
  GalleryRecordNotFoundError,
  GalleryRecordOwnershipError,
} from '@kernel/domain/gallery/gallery-errors.types';
import {
  databaseFailure,
  externalServiceFailure,
} from '@app/errors/error-result.helpers';
import { DB_CLIENT } from '@app/db/db.client';
import {
  assetUrlReferencesPublicId,
  extractPublicIdFromUrl,
} from '@app/cloudinary/cloudinary-url.utils';

/**
 * Normalize a client-supplied asset_id to a canonical Cloudinary public_id.
 * The endpoint contract is a bare public_id (e.g. `nailfolio/abc123`), but if a
 * full Cloudinary URL is sent we extract the public_id from it so the equality
 * compare against the stored record's public_id is apples-to-apples.
 */
const normalizeAssetId = (raw: string): string => {
  const trimmed = raw.trim();
  return extractPublicIdFromUrl(trimmed) ?? trimmed;
};

/**
 * Vendor-only Cloudinary delete. Ownership is checked here; the handler stays thin.
 * GALLERY_RECORD_NOT_FOUND covers both missing and not-owned (no existence leak).
 */
// DECISION: no frontend consumer; keep the route as a reserved cancel-upload capability.
// Upload writes no row until createGalleryRecord_IO, so a mid-flow cancel finds nothing
// and returns NOT_FOUND, while deleting only the file on a committed record leaves a
// broken image. A consumer must drop the row check (pre-commit) or also delete the record.
export const deleteAssetFromVendor_IO = async ({
  assetID,
  userID,
  stylistAccountId,
}: {
  assetID: CloudinaryType['asset_id'];
  userID: IDType;
  stylistAccountId: string;
}): Promise<
  OperationResult<
    { deleted: true },
    | ExternalServiceError
    | GalleryRecordNotFoundError
    | GalleryRecordOwnershipError
    | DatabaseError
  >
> => {
  // DECISION: VERIFY == ACT. Ownership is proven against the exact canonical public_id, and destroy()
  // acts on the public_id derived from the matched STORED record, never the raw client string; the old
  // `asset_url: { contains: assetID }` + `destroy(assetID)` let a loose substring of the owner's own URL pass
  // the gate while destroy() ran on whatever the client sent. `contains` stays only as an index-friendly
  // pre-filter, followed by an equality check on the public_id extracted from each stored asset_url
  // (mirrors gallery-delete.operation.ts).
  const normalizedAssetId = normalizeAssetId(assetID);

  let candidates;
  try {
    candidates = await DB_CLIENT.use.galleryRecord.findMany({
      where: {
        created_by_account_id: stylistAccountId,
        // escapeLikePattern ONLY on the `contains` pre-filter: `_` is common in Cloudinary
        // public_ids and would otherwise act as a single-char wildcard, and a trailing `\`
        // would crash the ILIKE (unmapped 500). The authoritative check remains the exact
        // public_id EQUALITY re-verify below (which uses the un-escaped normalizedAssetId).
        asset_url: { contains: escapeLikePattern(normalizedAssetId) },
      },
      select: { gallery_record_id: true, asset_url: true },
    });
  } catch (error) {
    return databaseFailure('deleteAssetFromVendor:ownershipCheck', error);
  }

  // Re-verify by EQUALITY: the extracted public_id of an owned record must equal the
  // normalized client input. A substring-only match (no exact public_id equality) does
  // NOT authorize the delete.
  const matched = candidates.find(
    record => extractPublicIdFromUrl(record.asset_url) === normalizedAssetId
  );

  if (!matched) {
    // DECISION: not-owned and missing both return GALLERY_RECORD_NOT_FOUND (404), not OWNERSHIP_ERROR
    // (403), so asset existence does not leak.
    return failure({
      type: 'GALLERY_RECORD_NOT_FOUND',
      recordId: normalizedAssetId,
    });
  }

  // Act on the public_id derived from the verified STORED record, never on raw client input.
  // matched.asset_url is a real stored Cloudinary URL, so extraction is guaranteed non-null
  // (it equalled normalizedAssetId above); fall back defensively to the verified normalized id.
  const verifiedPublicId =
    extractPublicIdFromUrl(matched.asset_url) ?? normalizedAssetId;

  // A gallery record does not confer permission to break another live photo or logo.
  // Include opaque legacy URLs with the same conservative matcher as the cleanup sink.
  try {
    const [users, accounts] = await Promise.all([
      DB_CLIENT.use.user.findMany({
        where: {
          OR: [{ avatar_url: { not: null } }, { image: { not: null } }],
        },
        select: { avatar_url: true, image: true },
      }),
      DB_CLIENT.use.stylistAccount.findMany({
        where: {
          OR: [
            { avatar_url: { not: null } },
            { salon_logo_url: { not: null } },
          ],
        },
        select: { avatar_url: true, salon_logo_url: true },
      }),
    ]);
    const references = [
      ...users.flatMap(row => [row.avatar_url, row.image]),
      ...accounts.flatMap(row => [row.avatar_url, row.salon_logo_url]),
    ];
    if (
      references.some(
        url => url !== null && assetUrlReferencesPublicId(url, verifiedPublicId)
      )
    ) {
      return failure({
        type: 'GALLERY_RECORD_NOT_FOUND',
        recordId: normalizedAssetId,
      });
    }
  } catch (error) {
    return databaseFailure('deleteAssetFromVendor:referenceCheck', error);
  }

  // DD3-F5 (2026-05-26): retry transient Cloudinary failures (3 attempts, exp backoff).
  // Network glitches between Vercel/Render edge and Cloudinary cause silent orphans —
  // sync delete path needs retry just like async cleanup in gallery-cloudinary-cleanup.ts.
  const RETRY_ATTEMPTS = 3;
  // DECISION: 500ms, not the kernel RETRY.BASE_DELAY_MS (1000): this delete runs synchronously inside the
  // user's HTTP request budget, so the backoff is deliberately tighter than the email/Stripe retry loops.
  // Do not merge it with the kernel RETRY.
  const RETRY_BASE_DELAY_MS = 500;
  const sleep = (ms: number): Promise<void> =>
    new Promise(resolve => setTimeout(resolve, ms));

  let lastError: unknown;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      await cloudinary.uploader.destroy(verifiedPublicId);

      reportIssueBackend({
        namespace: 'deleteAssetFromVendor',
        message: `Deleted asset ${verifiedPublicId} from vendor for user ${userID}${attempt > 1 ? ` (attempt ${attempt})` : ''}`,
        payload: { assetID: verifiedPublicId, attempts: attempt },
        mode: 'info',
      });

      return success({ deleted: true });
    } catch (error) {
      lastError = error;
      if (attempt < RETRY_ATTEMPTS) {
        await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1));
      }
    }
  }

  reportIssueBackend({
    namespace: 'deleteAssetFromVendor',
    message: `Failed to delete asset ${verifiedPublicId} after ${RETRY_ATTEMPTS} attempts`,
    payload: { assetID: verifiedPublicId, error: lastError },
    mode: 'error',
  });
  return externalServiceFailure('CLOUDINARY', 'deleteAsset', lastError);
};
