import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { runInstant } from '../../../application/routing/navigation.possibilities.api';
import { detectPlatform } from '../../../application/platform/platform.detection';
import { STORAGE_KEYS } from '../../../application/client-device-storage/storage-keys.config';
import {
  getSessionStorage,
  setSessionStorage,
} from '../../../application/client-device-storage/session-storage-adapter/sessionStorage.adapter';
import { useAuth } from '../../contexts/AuthContext.composition';

/**
 * Native-app entry redirect: when the app runs inside the Capacitor wrapper
 * (`detectPlatform().isNativeApp`), the landing page (`/`) is the wrong entry —
 * the wrapper IS the product. Logged-in → `/app` (authenticated shell, the
 * dashboard is the first screen). Logged-OUT → `/welcome` (the starter screen),
 * NOT raw `/app` → login bounce (owner S37: a logged-out native user should
 * meet a branded welcome with a clear path to log in / explore, not a bare
 * login form). Web visitors are untouched.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Page-level guard on `/` (mirror of useDesktopRedirectGuard), NOT AppLifecycle
 * / Next middleware. `detectPlatform()` reads `?platform=ios|android` (the
 * wrapper's launch param, persisted to sessionStorage) so it works under
 * remote-load where `Capacitor.isNativePlatform()` can be false. Client-side
 * only: the whole `/app` surface is SSG + token-in-localStorage, so edge
 * middleware has no session to act on. SSR-safe: `detectPlatform()` returns
 * `isNativeApp:false` on the server, so the SSG markup and the first client
 * render are identical (no hydration mismatch) — the redirect only fires
 * post-mount in a real wrapper (same post-mount-swap doctrine as
 * useDesktopAccess / useLandingContext).
 *
 * DECISION (nie usuwaj tego komentarza):
 * `isLoggedIn` (token-presence) is the right gate for ENTRY routing — not the
 * full live-session check. A logged-out native user has no token → /welcome;
 * a logged-in one → /app. A stale token (rare on native) lands on /app and
 * bounces to login as before; the entry split just replaces that bounce with a
 * welcome screen for the genuinely-logged-out case.
 *
 * DECISION (nie usuwaj tego komentarza):
 * ONCE-PER-SESSION via NATIVE_ENTRY_RESOLVED (sessionStorage). The redirect must
 * fire ONLY on cold-start (the wrapper opening the remote at `/`), NOT every time
 * the user navigates to home. Without this latch, a native user who taps "Strona
 * główna" on /welcome — or "Wróć do strony głównej" on the login screen — lands on
 * `/`, this guard re-fires, and bounces them straight back to /welcome: an
 * inescapable loop with no way to reach the home LP (owner report). The flag is
 * set on the first entry redirect (here AND in the pre-paint zero-flash bridge,
 * which handles the true cold-start), so any later user-initiated visit to home
 * renders the LP. sessionStorage clears on app relaunch → a fresh launch still
 * meets /welcome. Mirror of the pre-paint bridge's `native_entry_resolved` check.
 */
export function useNativeEntryRedirectGuard(): void {
  const router = useRouter();
  const { isLoggedIn } = useAuth();
  // DECISION (nie usuwaj): deps = [pathname, ..., router], NIE [router] —
  // `router` z next/router jest referencyjnie niestabilny (zmienia tożsamość na
  // każdy refresh: query/locale/isReady), więc samo [router] re-odpalałoby
  // efekt bez potrzeby. Gating na stabilnym `pathname` (jak siostrzane
  // useDesktopRedirectGuard / useRecoveryGuard); `router` zostaje jako uchwyt.
  const { pathname } = router;
  useEffect(() => {
    if (pathname !== ROUTES_FRONT.HOME) {
      return;
    }
    if (!detectPlatform().isNativeApp) {
      return;
    }
    // Cold-start latch: if the entry redirect already fired this session, this is
    // user-initiated navigation to home — render the LP, do NOT loop to /welcome.
    if (getSessionStorage(STORAGE_KEYS.NATIVE_ENTRY_RESOLVED) != null) {
      return;
    }
    // Mark entry resolved BEFORE redirecting, so a later user-initiated home visit
    // renders the LP instead of looping. Best-effort (adapter swallows failures);
    // a blocked write just means the redirect may repeat, never worse.
    setSessionStorage(STORAGE_KEYS.NATIVE_ENTRY_RESOLVED, '1');
    const target = isLoggedIn ? ROUTES_FRONT.APP : ROUTES_FRONT.WELCOME;
    void runInstant('native-entry-guard', () => router.replace(target), target);
  }, [pathname, router, isLoggedIn]);
}
