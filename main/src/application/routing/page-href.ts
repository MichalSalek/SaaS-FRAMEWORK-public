// DECISION: see main/src/application/routing/trailing-slash.ts (skipTrailingSlashRedirect and slashed
// hrefs). `skipTrailingSlashRedirect` puts Next in manual trailing-slash mode, so <Link> renders
// hrefs as written; `compiler.define` cannot override the built-in flag (Next throws E688), hence
// page hrefs get their slash here, in AppLinkAtom.
const NON_PAGE_PREFIXES = ['/api', '/ingest', '/_next', '/.well-known'];

/**
 * True for an href that points at one of our PAGES (a same-origin path the
 * router can render): not external or protocol-relative, not hash- or
 * query-only, not a file (`/llms.txt`, `/img/x.webp`), not API or Next internals.
 */
export function isInternalPageHref(href: string): boolean {
  if (!href.startsWith('/') || href.startsWith('//')) {
    return false;
  }
  const cut = href.search(/[?#]/);
  const path = cut === -1 ? href : href.slice(0, cut);
  if (
    NON_PAGE_PREFIXES.some(
      prefix => path === prefix || path.startsWith(`${prefix}/`)
    )
  ) {
    return false;
  }
  const lastSegment = path.slice(path.lastIndexOf('/') + 1);
  return !lastSegment.includes('.');
}

/**
 * Canonical form of an internal PAGE href: trailing slash before the query and
 * hash. Left untouched: external/protocol-relative URLs, hash-only or
 * query-only hrefs, files (`/llms.txt`, `/blog/x.md`), API and Next internals,
 * and anything already ending in a slash.
 */
export function withPageTrailingSlash(href: string): string {
  if (!isInternalPageHref(href)) {
    return href;
  }
  const cut = href.search(/[?#]/);
  const path = cut === -1 ? href : href.slice(0, cut);
  const rest = cut === -1 ? '' : href.slice(cut);
  return path.endsWith('/') ? href : `${path}/${rest}`;
}
