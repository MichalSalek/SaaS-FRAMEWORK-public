// DECISION (nie usuwaj tego komentarza):
// next.config.mjs keeps `skipTrailingSlashRedirect: true` because posthog-js
// posts to slashless paths (`/ingest/e`, `/ingest/i/v1/logs`), and a Next
// trailing-slash redirect would break them. That flag also switches Next into
// "manual trailing slash" mode, so <Link> renders hrefs exactly as written
// (`/en/blog`), and every internal link sent a crawler through a 301 to the
// canonical `/en/blog/`. `compiler.define` cannot override the built-in flag
// (Next throws E688), so page hrefs get their slash here, in AppLinkAtom.
const NON_PAGE_PREFIXES = ['/api', '/ingest', '/_next', '/.well-known'];

/**
 * Canonical form of an internal PAGE href: trailing slash before the query and
 * hash. Left untouched: external/protocol-relative URLs, hash-only or
 * query-only hrefs, files (`/llms.txt`, `/blog/x.md`), API and Next internals,
 * and anything already ending in a slash.
 */
export function withPageTrailingSlash(href: string): string {
  if (!href.startsWith('/') || href.startsWith('//')) {
    return href;
  }
  const cut = href.search(/[?#]/);
  const path = cut === -1 ? href : href.slice(0, cut);
  const rest = cut === -1 ? '' : href.slice(cut);
  if (path.endsWith('/')) {
    return href;
  }
  if (
    NON_PAGE_PREFIXES.some(
      prefix => path === prefix || path.startsWith(`${prefix}/`)
    )
  ) {
    return href;
  }
  const lastSegment = path.slice(path.lastIndexOf('/') + 1);
  if (lastSegment.includes('.')) {
    return href;
  }
  return `${path}/${rest}`;
}
