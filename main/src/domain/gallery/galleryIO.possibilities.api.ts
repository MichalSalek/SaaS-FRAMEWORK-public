import { ENV_VARS } from '../../application/environment/environment.config';
import { reportIssueFrontend } from '../../application/error-debugger/errorHandler.possibilities.api';
import { contractEndpoint } from '../../application/http/io';
import { GALLERY_CONTRACTS } from '@kernel/domain/gallery/gallery.contracts';
import {
  CLOUDINARY_UPLOAD_FLAGS,
  CLOUDINARY_UPLOAD_URL,
  cloudinaryUploadPreset,
} from './cloudinary-adapter/cloudinary.config';
import type { CloudinaryType } from './cloudinary-adapter/cloudinary.types';

// Cloudinary `delete_by_token` endpoint (sibling of the upload URL). Built inline
// here (not in cloudinary.config) to keep the draft-discard wiring contained.
const CLOUDINARY_DELETE_BY_TOKEN_URL = (cloudName: string) =>
  `https://api.cloudinary.com/v1_1/${cloudName}/delete_by_token` as const;

// 60s timeout for Cloudinary image uploads — longer than DEFAULT_REQUEST_TIMEOUT_MS (30s)
// because large multi-MB images on slow mobile connections legitimately exceed 30s.
const CLOUDINARY_UPLOAD_TIMEOUT_MS = 60_000;

// DECISION: `uploadAssetToVendor_IO` is a raw `fetch()` to Cloudinary, deliberately outside
// callHTTPEndpoint (no interceptor, own 60s AbortController, own error handler). It is not migrated
// to defineEndpoint: the `{ req, successCallback, errorCallback }` shape isolates the vendor fetch
// from the internal transport (io.ts EXCEPTIONS).
export const uploadAssetToVendor_IO = async ({
  req,
  successCallback,
  errorCallback,
}: {
  req: FormData;
  successCallback: (response: CloudinaryType) => void;
  errorCallback: (error: unknown) => void;
}) => {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(
    () => timeoutController.abort(),
    CLOUDINARY_UPLOAD_TIMEOUT_MS
  );

  try {
    const response = await fetch(
      CLOUDINARY_UPLOAD_URL(ENV_VARS.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME),
      { method: 'POST', body: req, signal: timeoutController.signal }
    );
    const data = (await response.json()) as CloudinaryType;
    if (response.ok) {
      successCallback(data);
    } else {
      reportIssueFrontend({
        namespace: 'uploadPhotoAsset_IO',
        message: `error.`,
        payload: data,
        mode: 'error',
      });
      errorCallback(data);
    }
  } catch (e) {
    reportIssueFrontend({
      namespace: 'uploadPhotoAsset_IO',
      message: `error.`,
      payload: e,
      mode: 'error',
    });
    errorCallback(e);
  } finally {
    clearTimeout(timeoutId);
  }
};

/**
 * Promise-first front door for an image upload: builds the `FormData` (preset, folder,
 * EXIF flags) and returns the vendor response.
 *
 * DECISION: the `FormData` assembly (preset, folder, EXIF flags) lives here once. It used to be
 * repeated in every upload hook (gallery, visit-result photo), and the stylist avatar would have
 * been a third copy, which is when copies drift. Drift is not cosmetic: `flags: strip_profile`
 * strips EXIF (GPS, phone model, date) from the file, so a copy that forgot it would publish the
 * stylist's home coordinates. Upload settings have one place.
 *
 * `uploadAssetToVendor_IO` (callback-based, isolated vendor fetch with its own timeout) stays as
 * the transport layer, see the DECISION at it.
 */
export const uploadImageToVendor_IO = async (
  file: File
): Promise<CloudinaryType> => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', cloudinaryUploadPreset);
  formData.append(
    'folder',
    ENV_VARS.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || 'nailfolio'
  );
  formData.append('flags', CLOUDINARY_UPLOAD_FLAGS);
  // DECISION: `return_delete_token` must NOT go as a request parameter: the provider then rejects
  // the WHOLE upload with 400. The token depends on the provider-side upload configuration; callers
  // read `delete_token ?? null`, which handles both states (no token = cleanup no-op, upload works).

  return new Promise<CloudinaryType>((resolve, reject) => {
    void uploadAssetToVendor_IO({
      req: formData,
      successCallback: resolve,
      errorCallback: reject,
    });
  });
};

// DECISION: draft-cancel cleanup. `delete_by_token` is a provider endpoint authorised by the
// `delete_token` itself (returned with the upload; valid ~10 min; scope = ONE fresh asset). That
// lets us delete an abandoned asset CLIENT-SIDE without a backend "any stylist deletes any
// public_id" (no secret, no risk of deleting someone else's photo). Raw vendor fetch, same
// deliberate isolation as `uploadAssetToVendor_IO`. Best-effort: returns a boolean and never throws
// (cleanup must not break unmount/navigation); failures are reported as 'warn'.
export const deleteAssetByToken_IO = async (
  deleteToken: string
): Promise<boolean> => {
  try {
    const body = new FormData();
    body.append('token', deleteToken);

    const response = await fetch(
      CLOUDINARY_DELETE_BY_TOKEN_URL(
        ENV_VARS.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
      ),
      { method: 'POST', body }
    );

    if (response.ok) {
      return true;
    }

    reportIssueFrontend({
      namespace: 'deleteAssetByToken_IO',
      message: 'Cloudinary delete_by_token returned a non-ok response.',
      payload: { status: response.status },
      mode: 'warn',
    });
    return false;
  } catch (e) {
    reportIssueFrontend({
      namespace: 'deleteAssetByToken_IO',
      message: 'Cloudinary delete_by_token threw.',
      payload: e,
      mode: 'warn',
    });
    return false;
  }
};

export const createGalleryRecord_IO = contractEndpoint(
  GALLERY_CONTRACTS.CREATE_GALLERY_RECORD
);

export const getGalleryRecords_IO = contractEndpoint(
  GALLERY_CONTRACTS.GET_GALLERY_RECORDS
);

export const updateGalleryRecord_IO = contractEndpoint(
  GALLERY_CONTRACTS.UPDATE_GALLERY_RECORD
);

export const deleteGalleryRecord_IO = contractEndpoint(
  GALLERY_CONTRACTS.DELETE_GALLERY_RECORD
);

export const getGalleryRecordById_IO = contractEndpoint(
  GALLERY_CONTRACTS.GET_GALLERY_RECORD_BY_ID
);

export const publicGetGalleryRecordsByAccount_IO = contractEndpoint(
  GALLERY_CONTRACTS.PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT
);

export const galleryPinRecord_IO = contractEndpoint(
  GALLERY_CONTRACTS.GALLERY_PIN_RECORD
);

export const galleryUnpinRecord_IO = contractEndpoint(
  GALLERY_CONTRACTS.GALLERY_UNPIN_RECORD
);

export const galleryReorderPinnedRecords_IO = contractEndpoint(
  GALLERY_CONTRACTS.GALLERY_REORDER_PINNED_RECORDS
);

export const galleryGetPinnedRecords_IO = contractEndpoint(
  GALLERY_CONTRACTS.GALLERY_GET_PINNED_RECORDS
);

export const getColors_IO = contractEndpoint(GALLERY_CONTRACTS.GET_COLORS);

export const getTraits_IO = contractEndpoint(GALLERY_CONTRACTS.GET_TRAITS);

export const galleryGetForPairedClient_IO = contractEndpoint(
  GALLERY_CONTRACTS.GALLERY_GET_FOR_PAIRED_CLIENT
);

export const exploreGalleryRecords_IO = contractEndpoint(
  GALLERY_CONTRACTS.EXPLORE_GALLERY_RECORDS
);
