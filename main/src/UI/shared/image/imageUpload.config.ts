// UI/shared/image/imageUpload.config.ts
// Shared input gate for both image upload paths: the styling wizard (UploadAssetPage) and the
// stylist profile photo (StylistAvatarField). Sits next to imageCrop.utils.ts because it is the
// same stage: "the user picked a file, before anything goes over the network".
//
// The MIME array is the single source; the `accept` string is derived from it,
// so the two upload paths and their validation cannot drift apart.

/** Formats accepted from the user. Source of truth for both paths. */
export const ACCEPTED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type AcceptedImageMimeType = (typeof ACCEPTED_IMAGE_MIME_TYPES)[number];

/** Value of the `accept` attribute on `<input type="file">`, derived from the list. */
export const ACCEPTED_IMAGE_ACCEPT_ATTR = ACCEPTED_IMAGE_MIME_TYPES.join(',');

/** Whether the file has an accepted type (no guessing from the extension). */
export function isAcceptedImageMimeType(mimeType: string): boolean {
  return (ACCEPTED_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
}
