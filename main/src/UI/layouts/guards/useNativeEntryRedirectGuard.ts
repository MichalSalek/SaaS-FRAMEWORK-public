/**
 * Kept as a call-site compatibility hook for HomePageComposition.
 *
 * Native cold-start routing now lives in NativeEntryBootstrap under _app: it validates the stored
 * bearer before mounting a protected page and coordinates the splash handoff. A page-level
 * token-presence redirect here would race that validation and could surface LOGIN_FIRST.
 */
export function useNativeEntryRedirectGuard(): void {
  // Intentionally empty. The app-level bootstrap owns native entry and the sessionStorage latch.
}
