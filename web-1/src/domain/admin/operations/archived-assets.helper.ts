import {
  assetUrlReferencesPublicId,
  extractPublicIdFromUrl,
} from '@app/cloudinary/cloudinary-url.utils';

/**
 * Collects file URLs from the raw `DeletedUser.body` archive.
 *
 * DECISION: a recursive walk over every `asset_url` / `avatar_url` key, never a list of paths. The
 * archive grows by contract (userRelationsArchiveEnabler: add every new cascading model), and a path
 * list would drift silently on the first new model with photos, leaving files in the cloud.
 * `avatar_url` is named differently from the other file columns, so walking `asset_url` alone left the
 * deleted account's profile photo behind. The Json column has a loose shape, so the walk tolerates
 * nulls and swapped types. A URL alone never deletes a file: cleanupCloudinaryAssets still checks no
 * live row references it (fail-closed).
 */

/** Recursion ceiling. The archive is shallow, and this stops a cycle in the data. */
const MAX_DEPTH = 12;

export const collectArchivedAssetUrls = (body: unknown): string[] => {
  const urls = new Set<string>();
  const oauthImages = new Set<string>();

  const walk = (node: unknown, depth: number): void => {
    if (depth > MAX_DEPTH || node === null || typeof node !== 'object') {
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item, depth + 1);
      }
      return;
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === 'image' && typeof value === 'string') {
        oauthImages.add(value);
      }
      if (
        (key === 'asset_url' ||
          key === 'avatar_url' ||
          key === 'salon_logo_url') &&
        typeof value === 'string' &&
        value !== ''
      ) {
        urls.add(value);
        continue;
      }
      walk(value, depth + 1);
    }
  };

  walk(body, 0);
  return [...urls].filter(url => {
    const publicId = extractPublicIdFromUrl(url);
    return ![...oauthImages].some(
      image =>
        image === url ||
        (publicId !== null && assetUrlReferencesPublicId(image, publicId))
    );
  });
};
