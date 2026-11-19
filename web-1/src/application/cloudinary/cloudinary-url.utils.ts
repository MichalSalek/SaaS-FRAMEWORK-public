/**
 * Deriving `public_id` from a Cloudinary file URL.
 *
 * DECISION: NORMALIZE BEFORE COMPARING. `public_id` drives an IRREVERSIBLE side effect
 * (`uploader.destroy` / `api.delete_resources`), and one cloud file has infinitely many URL
 * spellings (`%20`, no extension, `//`, `./`, `../`, `%2F..%2F`, `?v=1.2` were measured bypasses of
 * the ownership gate `findForeignAssetOwner` and the reference check `filterUnreferencedUrls`).
 * So the URL is normalized to the form the cloud operates on: strip query and fragment,
 * percent-decode (Cloudinary deletes by the DECODED form), collapse `//`, resolve `.`/`..`, drop
 * the extension. The version number is accepted in any letter case.
 *
 * The `v<digits>` segment stays REQUIRED: without it a folder cannot be told from a transformation
 * segment (`/upload/w_200/foo.jpg`). A URL without a version is UNRECOGNIZED, and both callers
 * treat that as the worst case.
 */

/** Cuts the query and fragment: they are not part of the file identifier. */
const stripQueryAndFragment = (assetUrl: string): string =>
  assetUrl.split('#')[0]?.split('?')[0] ?? '';

/**
 * Percent-decodes. An invalid sequence (`%zz`) throws; we then keep the input
 * unchanged so a strange address does not become an exception on a path that
 * only compares.
 */
const decodePathSafely = (path: string): string => {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
};

/** Collapses `//`, drops `.` segments and resolves `..`. */
const normalizeSegments = (path: string): string => {
  const resolved: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  return `/${resolved.join('/')}`;
};

const normalizeAssetUrl = (assetUrl: string): string =>
  normalizeSegments(decodePathSafely(stripQueryAndFragment(assetUrl)));

// Anchor the normalized delivery route. A fetch target may itself contain an
// /upload/v123/ path, but it must never identify a file in our upload library.
const UPLOAD_PATH_REGEX =
  /^\/https:\/res\.cloudinary\.com\/[^/]+\/image\/upload\/(?:.*?\/)?v\d+\/(.+)$/i;
const TRAILING_EXTENSION_REGEX = /\.[^./]+$/;
// C0 controls (U+0000–U+001F) and DEL (U+007F), compared by UTF-16 code unit, exactly what the
// former `/[\u0000-\u001f\u007f]/` matched (written as a loop because `no-control-regex`
// forbids control characters in a pattern and inline lint exceptions are disabled).
const hasControlCharacter = (value: string): boolean => {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
};

/**
 * Rozkłada adres JUŻ znormalizowany (patrz `normalizeAssetUrl`).
 *
 * DECISION: a control character after decoding means UNRECOGNIZED. The global input gate rejects
 * raw control characters, but `%00` passes it as three ordinary characters and only
 * `decodePathSafely` turns it into NUL. That identifier then reached `WHERE public_id = ...` and
 * Postgres rejected the query (22021) outside any try, giving a 500 on set-avatar and
 * create-gallery-record. Cloudinary issues no identifiers with control characters, so such a URL
 * points at no real file: return `null` ("unrecognized"), which both callers read as the worst
 * case (the ownership gate rejects the attacker's URL with UNRECOGNIZED_URL -> 400; a stored row
 * with such a URL falls onto the substring path in `assetUrlReferencesPublicId`, which protects).
 * Do NOT "clean" the identifier by dropping the character: that yields a different file than the
 * one the URL names and drifts normalization from reality again.
 */
const publicIdFromNormalizedUrl = (normalizedUrl: string): string | null => {
  if (hasControlCharacter(normalizedUrl)) {
    return null;
  }
  const match = normalizedUrl.match(UPLOAD_PATH_REGEX);
  const withExtension = match?.[1];
  if (withExtension === undefined || withExtension.length === 0) {
    return null;
  }
  const publicId = withExtension.replace(TRAILING_EXTENSION_REGEX, '');
  return publicId.length > 0 ? publicId : null;
};

export const extractPublicIdFromUrl = (assetUrl: string): string | null =>
  publicIdFromNormalizedUrl(normalizeAssetUrl(assetUrl));

/**
 * Does `storedAssetUrl` refer to the file `publicId`? The only "this row protects this
 * file" predicate. It must run in code, over the column value.
 * DECISION: normalize both sides the same way. Never narrow candidates with a raw
 * `contains` literal: a stored `//` or encoded form misses the set, the gate compares
 * nothing and rules OWN. Unparsed rows keep NULL `public_id` and stay on this path
 * (see cloudinary-asset.guard.ts). An unparsed row that contains the identifier counts
 * as a reference, so uncertainty stays with the file's owner.
 */
export const assetUrlReferencesPublicId = (
  storedAssetUrl: string,
  publicId: string
): boolean => {
  const normalized = normalizeAssetUrl(storedAssetUrl);
  const storedPublicId = publicIdFromNormalizedUrl(normalized);
  return storedPublicId === null
    ? normalized.includes(publicId)
    : storedPublicId === publicId;
};

/**
 * Spelling variants of the identifier for the candidate LOOKUP in the database
 * (`asset_url contains ...`).
 *
 * DECISION: normalizing at comparison time is NOT enough if the candidate lookup is by literal.
 * The column holds the URL as it arrived, and Cloudinary's `secure_url` percent-encodes spaces and
 * diacritics, so searching for the decoded name misses a row stored as "file%20name" and the
 * ownership gate let a canonical variant of someone else's file through. `encodeURI` (not
 * `encodeURIComponent`): folder slashes are part of the identifier and stay literal.
 * These variants catch percent-encoding but NOT `//`, `/./`, `/../` or single encoded characters
 * (see `assetUrlReferencesPublicId`). A candidate set narrowed by these terms MUST be treated as
 * incomplete; a security or irreversible-deletion check must run `assetUrlReferencesPublicId`
 * over the FULL row set.
 */
export const publicIdSearchTerms = (publicId: string): string[] => {
  const encoded = encodeURI(publicId);
  return encoded === publicId ? [publicId] : [publicId, encoded];
};
