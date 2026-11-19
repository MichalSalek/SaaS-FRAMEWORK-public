// main/src/application/auth/auth-code.helpers.ts
// URL helpers for the variant-C post-login token bridge (?authCode=...).
//
// DECISION: read from `window.location.search`, NOT Next.js `router.query`. The /app shells are SSG
// and in the Pages Router `router.query` is EMPTY on the first client render until hydration
// completes (router.isReady). The auth-code exchange MUST run on the very first render (before any
// guard reads isLoggedIn), so router.query is too late; `window.location.search` is populated
// synchronously on mount. Same pattern as `application/platform/platform.detection.ts` (`?platform=`).

const AUTH_CODE_PARAM = 'authCode';
/** `true` once the exchange flow has scrubbed the code (see `scrubRestoredAuthCodeFromUrl`). */
let hasExchangeScrubbed = false;

/**
 * Read the `authCode` query param from the live browser URL. Returns `null`
 * when absent, empty, or running on the server (SSR/SSG prerender).
 */
export function readAuthCodeFromUrl(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const value = new URLSearchParams(window.location.search).get(
    AUTH_CODE_PARAM
  );
  // Treat empty / whitespace-only as absent (malformed link).
  if (value === null || value.trim() === '') {
    return null;
  }
  return value;
}

/**
 * Remove the `authCode` param from the current URL via history.replaceState,
 * preserving everything else: the locale prefix (`/pl/app`, `/en/app`,
 * `/de/app`), the rest of the path, all other query params (e.g. `?role=stylist`)
 * and any hash. No navigation, no reload — just scrubs the sensitive one-time
 * code out of the address bar / history entry so it cannot be re-shared or
 * replayed from back/forward.
 *
 * SSR-safe (no-op on the server). Wrapped in try/catch because history APIs can
 * throw in exotic embedded contexts; a failed scrub must never block the app.
 */
export function scrubAuthCodeFromUrl(): void {
  if (typeof window === 'undefined') {
    return;
  }
  hasExchangeScrubbed = true;
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(AUTH_CODE_PARAM)) {
      return;
    }
    url.searchParams.delete(AUTH_CODE_PARAM);
    // Build a relative URL so the locale prefix + path stay byte-identical and
    // we never accidentally cross-origin. pathname already carries `/pl/app`.
    const cleaned = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(window.history.state, '', cleaned);
  } catch {
    // History API unavailable / blocked — leave the URL as-is. The token is
    // already in storage; a stale authCode in the bar is harmless (single-use,
    // 60s TTL, already consumed).
  }
}

/**
 * Scrub once more, AFTER the router has reported ready.
 *
 * DECISION: right after hydration Next's router syncs the query with the address it read at
 * start. When the code exchange had already finished, that sync wrote the CONSUMED code back into
 * the address for good. Called from `_app.tsx` once `router.isReady`. It does nothing until the
 * exchange has cleaned the address itself: before that the code MUST stay in the address because
 * AuthContext reads it from there.
 */
export function scrubRestoredAuthCodeFromUrl(): void {
  if (hasExchangeScrubbed) {
    scrubAuthCodeFromUrl();
  }
}
