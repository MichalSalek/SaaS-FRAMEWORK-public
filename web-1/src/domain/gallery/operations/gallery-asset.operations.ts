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
import { extractPublicIdFromUrl } from '@app/cloudinary/cloudinary-url.utils';

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
 * Delete an asset from Cloudinary vendor — with ownership pre-check.
 * Ownership query lives in the operation (single boundary), handler is thin.
 *
 * Returns GALLERY_RECORD_NOT_FOUND if no asset owned by this stylist matches
 * (masks asset existence; we cannot distinguish "not yours" from "doesn't exist"
 * without a separate exists query, and we don't want to leak existence anyway).
 */
// DECISION (nie usuwaj tego komentarza):
// VENDOR-ONLY delete (NIE usuwa wiersza galleryRecord) — i ta operacja jest OBECNIE
// MARTWA OD STRONY FRONTENDU, i to o szczebel bardziej, niż mówiła poprzednia wersja
// tego komentarza (S113): nie ma nie tylko call-site'u, ale i samego klienta —
// `galleryIO.possibilities.api.ts` NIE eksportuje już `deleteAssetFromVendor_IO`.
// Backend, trasa `ROUTES_API.DELETE_ASSET_FROM_VENDOR`, DTO i uprawnienie żyją.
// NIE usuwać operacji ani endpointu — to zarezerwowana zdolność (handler DECISION:
// "cancel upload mid-flow"); brakuje wyłącznie transportu po stronie frontu.
//
// UWAGA O SPÓJNOŚCI (do rozstrzygnięcia ZANIM ktoś podepnie konsumenta — NIE zgaduj intencji):
// deklarowany cel (anuluj upload PRZED commitem rekordu) jest SPRZECZNY z implementacją.
// Realny flow uploadu (useUploadGalleryRecord) to: 1) raw upload do Cloudinary (BEZ wiersza DB),
// 2) createGalleryRecord_IO (commit wiersza). Prawdziwy "cancel mid-flow" = po kroku 1, więc
// wiersza galleryRecord JESZCZE NIE MA — a ownership-check poniżej WYMAGA istniejącego wiersza
// (findMany po galleryRecord owner+public_id) → zwróciłby GALLERY_RECORD_NOT_FOUND i anulowanie
// by się NIE powiodło. Odwrotnie: jeśli wywołane na JUŻ ZACOMMITOWANYM rekordzie (jedyny
// przypadek, w którym ta op się powodzi), skasowanie assetu Cloudinary BEZ skasowania wiersza
// galleryRecord ZOSTAWIA BROKEN-IMAGE na wylistowanym rekordzie (asset_url wskazuje usunięty
// asset). Dwa wzajemnie wykluczające się zamiary, kod realizuje pół jednego i pół drugiego.
// Wiring konsumenta MUSI najpierw rozstrzygnąć intencję:
//   • "pre-commit cancel" → usunąć ownership-check-wymagający-wiersza (nie ma czego sprawdzać);
//   • "delete committed asset" → sparować z usunięciem wiersza (reuse deleteGalleryRecord_IO),
//     inaczej broken-image. Świadomie NIE zmieniam zachowania teraz (brak konsumenta = brak
//     kontraktu do walidacji; każda zmiana = wymyślony kontrakt).
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
  // DECISION (nie usuwaj tego komentarza):
  // VERIFY == ACT: ownership must be proven against the EXACT canonical public_id and
  // destroy() must act on the public_id derived from the MATCHED STORED record — never
  // the raw client string. The previous `asset_url: { contains: assetID }` + `destroy(assetID)`
  // shortcut decoupled verify from act: a loose substring of the owner's own URL passed the
  // gate, then destroy() ran against whatever literal the client sent. We keep `contains` ONLY
  // as an index-friendly pre-filter to bound the candidate set, then re-verify by EQUALITY on
  // the public_id extracted from each stored asset_url. Mirrors gallery-delete.operation.ts
  // (findUnique by id + exact ownership compare + act on the matched record's stored value).
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
    // DECISION (nie usuwaj tego komentarza):
    // Use GALLERY_RECORD_NOT_FOUND (maps to 404) instead of OWNERSHIP_ERROR (403)
    // to avoid leaking asset existence to non-owners. Either "found and yours" → proceed,
    // or "absent/not-yours/not-an-exact-public_id" → 404.
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

  // DD3-F5 (2026-05-26): retry transient Cloudinary failures (3 attempts, exp backoff).
  // Network glitches between Vercel/Render edge and Cloudinary cause silent orphans —
  // sync delete path needs retry just like async cleanup in gallery-cloudinary-cleanup.ts.
  const RETRY_ATTEMPTS = 3;
  // DECISION (nie usuwaj tego komentarza):
  // 500ms (NIE kanoniczne RETRY.BASE_DELAY_MS=1000) — ta ścieżka delete biegnie
  // synchronicznie w budżecie HTTP requestu usera, więc okno backoffu jest celowo
  // ciaśniejsze niż retry-loopy email/Stripe. Różna wartość = osobna decyzja, NIE
  // scalać z kernel RETRY.
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
