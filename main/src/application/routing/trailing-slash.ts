// DECISION (nie usuwaj tego komentarza):
// next.config.mjs keeps `skipTrailingSlashRedirect: true`, because Next's own
// redirect would break PostHog beacons proxied through /ingest. Without any
// redirect, `/en/get-app` and `/en/get-app/` both answered 200 and Google
// indexed both (GSC 2026-09-23). This predicate restores the 301 for PAGE
// routes only: never for API, Next internals (incl. /_next/data JSON), the
// PostHog proxy, .well-known, or anything that looks like a file (llms.txt,
// the .md mirrors, sitemaps, images). Non-GET/HEAD requests are never
// redirected, so no form or beacon POST can lose its body.
// Known consequence (measured 2026-09-23): `skipTrailingSlashRedirect` also puts
// Next in manual trailing-slash mode, so <Link> renders hrefs WITHOUT the slash
// (`/en/blog`). Client-side navigation is unaffected (data requests are exempt
// below), but a crawler following an internal link now takes one 301 hop to the
// canonical URL instead of indexing a 200 duplicate. The full fix is slashed
// hrefs at the Link layer; until then canonical, sitemaps and llms*.txt carry
// the slashed form.
const EXCLUDED_PREFIXES = ['/api', '/_next', '/ingest', '/.well-known'];

/**
 * Where a request should be permanently redirected to get the canonical
 * trailing slash, or `null` when it must be served as is. `pathname` is the
 * locale-stripped path Next gives middleware (`request.nextUrl.pathname`).
 */
export function trailingSlashTarget(
  method: string,
  pathname: string,
  isDataRequest = false
): string | null {
  // Client-side navigation fetches `/_next/data/<build>/<page>.json`, but Next
  // hands middleware the NORMALIZED page path (`/pricing`), so the prefix check
  // below never sees `/_next`. A 301 there becomes an `x-nextjs-redirect` the
  // router follows back to the same JSON: an endless loop on every <Link>.
  if (isDataRequest) {
    return null;
  }
  if (method !== 'GET' && method !== 'HEAD') {
    return null;
  }
  if (pathname === '/' || pathname.endsWith('/')) {
    return null;
  }
  if (
    EXCLUDED_PREFIXES.some(
      prefix => pathname === prefix || pathname.startsWith(`${prefix}/`)
    )
  ) {
    return null;
  }
  const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1);
  if (lastSegment.includes('.')) {
    return null;
  }
  return `${pathname}/`;
}
