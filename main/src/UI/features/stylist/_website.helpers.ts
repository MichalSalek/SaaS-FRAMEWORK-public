// main/src/UI/features/stylist/_website.helpers.ts
// The stylist's own website (stylist_account.website): the one place where
// we decide whether the DB value is fit to show and how to label it.
// Used by JSON-LD (sameAs) and the public profile header, so the
// visible link and the structured data never diverge on the rules.

/**
 * Returns an address ready to use as `href`/`sameAs`, or null.
 *
 * DECISION: defense in depth at RENDER. The write path already validates the field
 * (validateOptionalHttpsUrl), but the public profile renders the DB value, and a `javascript:`
 * URL that slipped through would reach `openExternalUrl` → `window.open`. Hence a hard
 * https: check, not `Boolean(website)`.
 */
export function normalizeExternalHttpsUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' || parsed.hostname.length === 0) {
      return null;
    }
    if (parsed.username.length > 0 || parsed.password.length > 0) {
      return null;
    }
  } catch {
    return null;
  }
  return trimmed;
}

/**
 * The link label: without `https://`, without `www.` and without a trailing slash.
 * We link the full address and show only the domain (the path stays if the
 * stylist gives a deeper link).
 */
export function formatExternalUrlLabel(url: string): string {
  return url
    .replace(/^https:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '');
}
