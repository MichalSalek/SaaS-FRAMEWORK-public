import {
  createContext,
  useContext,
  useRef,
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AccountType } from '@kernel/models/db_models.generated.dto';
import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { readLocalePrefix } from '@kernel/domain/routing/app-path.utils';
import { authClient, signOut } from '../../application/auth/better-auth-client';
import { getSessionAccountType } from '../../application/auth/session-fields.helpers';
import {
  readAuthCodeFromUrl,
  scrubAuthCodeFromUrl,
} from '../../application/auth/auth-code.helpers';
import {
  AUTH_TOKEN_CLEARED_EVENT,
  clearAuthChannelTokens,
} from '../../application/auth/auth-token-teardown';
import {
  captureFreshLoginSignals,
  clearLoginStarted,
  needsLoginConfirmation,
  persistSessionToken,
} from '../../application/auth/login-confirmation';
import {
  useLoginConfirmationGate,
  type LoginConfirmation,
} from './useLoginConfirmationGate';
import { useSessionRecovery } from './useSessionRecovery';
import { useCachedCurrentUser } from '../shared/hooks/useCurrentUserAccount';
import { exchangeAuthCode_IO } from '../../domain/auth/authIO.possibilities.api';
import { queryKeys } from '../../application/http/queryKeys.factory';
import {
  getFromClientStorage,
  deleteFromClientStorage,
} from '../../application/client-device-storage/clientStorage.possibilities.api';
import { STORAGE_KEYS } from '../../application/client-device-storage/storage-keys.config';
import { requestCancellationService } from '../../application/http/request-cancellation.service';
import { bypassLeaveGuard } from '../../application/routing/leave-guard';

// ---------------------------------------------------------------------------
// Isomorphic layout effect
// ---------------------------------------------------------------------------

// DECISION (nie usuwaj tego komentarza):
// useLayoutEffect na serwerze (SSG prerender) nie odpala sie i emituje ostrzezenie
// React ("useLayoutEffect does nothing on the server"). Aliasujemy go do useEffect
// gdy `window` nie istnieje, zeby SSR/SSG bylo ciche, a na kliencie zachowac
// SYNCHRONICZNY, pre-paint timing (krytyczny dla bramki authCode ponizej —
// zamyka sie zanim cokolwiek namaluje sie zalogowane-wylogowane i zanim pasywne
// guardy useEffect dzieci sie odpala).
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuthState {
  /** Whether the user has a valid token in storage */
  isLoggedIn: boolean;
  /** Current user's account type (STYLIST | CLIENT), null when logged out */
  accountType: AccountType | null;
  /** Clear tokens and redirect to login */
  logout: () => void;
  /**
   * Re-derive `isLoggedIn` from the token currently in storage. Needed by
   * out-of-band token-stamp flows (dev quick-login) that persist the bearer
   * token via the HTTP interceptor OUTSIDE the variant-C authCode exchange —
   * `isLoggedIn` is a useState seeded once at mount and is not reactive to a
   * same-tab storage write, so those flows must signal the change explicitly.
   */
  syncLoggedInFromStorage: () => void;
  /**
   * s34 login-CSRF gate: non-null while a fresh ?authCode login waits for the
   * user to confirm the account ("Logujesz się jako {email}"); the new token is
   * then held in memory only. While non-null the app tree must not mount
   * (LoginConfirmGate in _app). See application/auth/login-confirmation.ts.
   */
  loginConfirmation: LoginConfirmation | null;
  /** "Tak, to moje konto": persist the new token, then let the app mount. */
  confirmFreshLogin: () => void;
  /** "Nie, to nie ja": revoke the new session (storage untouched), reload. */
  rejectFreshLoginAndReload: () => void;
}

interface AuthProviderProps {
  children: ReactNode;
}

// ---------------------------------------------------------------------------
// Helpers — thin wrappers to avoid importing clientStorage everywhere
// ---------------------------------------------------------------------------

// Token read/clear go through the canonical clientStorage adapters
// (sessionStorage-first read, SSR-guard, error reporting) — never raw
// localStorage/sessionStorage. Clear scope is unchanged: the authorization
// token + the admin become-user token.
function getToken(): string | null {
  return getFromClientStorage({ key: CUSTOM_HEADERS.authorization });
}

function clearTokens(): void {
  // Auth-channel keys (session + impersonation) live in ONE place —
  // auth-token-teardown.clearAuthChannelTokens — shared with the transport-level
  // teardown that drops a server-refused token. Logout composes it with the
  // funnel cleanup below instead of re-listing the keys (they drifted apart
  // before: the interceptor, this context and the teardown each knew their own
  // subset).
  clearAuthChannelTokens();
  // SPE: drop the pricing-funnel intent on logout. sessionOnly only scopes per-tab,
  // so a logout->login in the SAME tab (shared device/kiosk) would otherwise let the
  // next user inherit the previous user's plan choice (wrong/pricier plan pre-selected
  // in onboarding + plan-aware login banner). Clear it with the identity.
  deleteFromClientStorage({ key: STORAGE_KEYS.PRICING_FUNNEL });
  // Ten sam powód dotyczy szkicu onboardingu (S123): niesie imię, miasto i
  // telefon, więc po wylogowaniu na wspólnym urządzeniu nie może wpaść do
  // formularza następnej osoby.
  deleteFromClientStorage({ key: STORAGE_KEYS.ONBOARDING_DRAFT });
}

// DECISION (nie usuwaj tego komentarza):
// Admin impersonation (BECOME_USER / SWITCH_BACK_BECOME_USER / REFRESH_IMPERSONATION)
// is NOT plumbed through AuthContext. The IO functions in
// `main/src/domain/admin/users/adminUsersIO.possibilities.api.ts` orchestrate the full
// switch end-to-end:
//   1. cancelAll() in-flight requests (identity changing)
//   2. POST to backend — Better Auth swaps session token via response header
//   3. http.interceptor.headers persists become-user/auth tokens to storage
//      out-of-band (CUSTOM_HEADERS.becomeUser / .authorization)
//   4. setCurrentUser() refreshes the active CurrentUser
//   5. redirectToByEvent() routes to /app or /admin/users via
//      REDIRECTIONS_ON_EVENTS in the shared-kernel routing config
// The impersonation token is opaque (HMAC.ref_id.expiresAt) — never exposed
// to React state or logged. `useAppRole.isBecomeUser` derives the impersonation
// flag by inspecting CUSTOM_HEADERS.becomeUser presence in storage, which is
// the single source of truth for UI gating (ImpersonationBanner).

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthState | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProviderComposition({ children }: AuthProviderProps) {
  // Derive initial logged-in state from token presence
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(
    () => getToken() !== null
  );

  const queryClient = useQueryClient();

  // Derive accountType from Better Auth session (additionalFields.account_type).
  // Reactive: changes whenever session refreshes (login, logout, role switch).
  // Cast + narrowing centralized in getSessionAccountType helper — it returns
  // `AccountType | null` directly, so no further narrowing is needed here.
  //
  // DECISION (nie usuwaj tego komentarza):
  // We also pull `refetch` off useSession(). Verified against better-auth 1.6.3
  // source: `authClient.getSession()` is an imperative proxy fetch to /get-session
  // whose path is NOT in the `$sessionSignal` atomListeners matcher (client/config.mjs
  // — only /sign-out, /sign-in/email, /sign-up/email, /update-user, /delete-user,
  // /revoke-* etc. flip the signal), so it NEVER calls the session atom's value.set()
  // and the reactive `useSession()` data stays STALE after it resolves. By contrast
  // `refetch` (client/query.mjs `fn()` → onSuccess → value.set({data,...})) writes the
  // atom directly, so the React `useStore` consumer re-renders with the fresh session.
  // We use refetch (not getSession) after a fresh login so the reactive atom carries
  // the post-login session before the idle-guard below re-runs.
  const {
    data: session,
    isPending: sessionPending,
    error: sessionError,
    refetch: refetchSession,
  } = authClient.useSession();
  // DECISION (nie usuwaj tego komentarza) — 2026-10-09:
  // sesja jest pierwszym źródłem aktywnej roli, ale nie jedynym. Gdy atom sesji
  // jest pusty przy zapisanym tokenie (powód i ponawianie: DECISION w
  // application/auth/session-recovery.ts), rolę bierzemy z zapytania o konto,
  // które czyta ten sam wiersz `users`. `null` zostaje wyłącznie dla „naprawdę
  // nie wiem” i żaden konsument nie może go rysować jako klientki.
  const cachedCurrentUser = useCachedCurrentUser();
  const cachedAccountType = isLoggedIn
    ? (cachedCurrentUser?.account_type ?? null)
    : null;
  const accountType: AccountType | null =
    getSessionAccountType(session) ?? cachedAccountType;

  // DECISION (nie usuwaj tego komentarza):
  // Bootstrap-window protection for the idle-expiry guard below. A FRESH login
  // (magic-link/OAuth variant-C exchange, or dev-login) starts with NO token, so
  // the useSession() atom's first fetch settles `data:null` BEFORE the token is
  // stored. After exchange we repopulate the atom via refetchSession(), but the
  // guard could still re-run on the stale-null window between flipping the gate
  // and the refetch landing. This ref records whether the session has EVER been
  // observed non-null since mount. The guard only treats `null` as a real expiry
  // once we've seen a real session at least once — so a just-logged-in user is
  // never bounced even if the refetch is delayed or fails. Genuine idle-expiry
  // (session was non-null, then becomes null) still trips the guard.
  const sessionWasNonNullRef = useRef(false);
  useEffect(() => {
    if (session !== null && session !== undefined) {
      sessionWasNonNullRef.current = true;
    }
  }, [session]);

  // ── Variant-C post-login token bridge (?authCode=…) ──────────────────────
  // DECISION (nie usuwaj tego komentarza):
  // TIMING-CRITICAL GATE. After magic-link/OAuth login the backend redirects to
  // the FRONTEND with `?authCode=<one-time code>`. The bearer token is NOT in
  // the URL — we must POST the code to exchange it, and the token lands in
  // localStorage['authorization'] (written by http.interceptor on the response
  // header). The token MUST be in storage BEFORE any guard or query reads it,
  // otherwise: authCode present → token not yet exchanged → hasSessionToken()
  // false → currentUser query disabled + Better Auth session null → the user
  // looks logged-OUT and the dashboard/onboarding guard bounces them to
  // /user/login despite a perfectly valid fresh login.
  //
  // We close the race by GATING the whole child tree while a code is present, so
  // NO child (page, guard, useCurrentUserAccount, useSession consumers) ever
  // EVALUATES against a not-yet-exchanged token. The exchange effect below awaits
  // the exchange, rehydrates the session, then flips the gate off — at which point
  // children mount with the token already persisted.
  //
  // DECISION (nie usuwaj tego komentarza):
  // HYDRATION-IDENTICZNA, DWUFAZOWA BRAMKA (fix KNOWN#2). Wczesniej `authCodePending`
  // startowal z lazy-initializera czytajacego window.location.search. To dawalo
  // ROZJAZD hydracji na KAZDYM logowaniu magic-link: serwer (SSG prerender) nie ma
  // window -> readAuthCodeFromUrl()===null -> false -> renderuje `children`; klient
  // na URL-u z ?authCode -> true -> renderuje <AuthCodeBootstrapFallback/>. React
  // widzi inne pierwsze drzewo na serwerze vs kliencie => hydration mismatch error.
  //
  // Faza 1: init `false` (DOKLADNIE jak SSR) -> pierwszy render klienta jest
  //   bajtowo identyczny z HTML-em serwera (zawsze `children`), wiec ZERO rozjazdu
  //   hydracji — i to na sciezce wspolnej (zwykla nawigacja BEZ authCode nigdy nie
  //   ma kodu w URL, wiec `authCodePending` zostaje false i common-path renderuje
  //   children tak samo na serwerze i kliencie).
  // Faza 2: w useIsomorphicLayoutEffect (SYNCHRONICZNIE, PRZED pierwszym paintem na
  //   kliencie) odczytujemy readAuthCodeFromUrl() i gdy kod jest obecny robimy
  //   setAuthCodePending(true). Bo to LAYOUT-effect, bramka zamyka sie do fallbacku
  //   w tym samym commicie ZANIM przegladarka namaluje wylogowany SSG-shell dziecka
  //   ORAZ zanim odpala sie PASYWNE useEffect-y guardow dzieci (idle-expiry,
  //   recovery) — anti-bounce intent (DECISION 146-166) zachowany w pelni: zaden
  //   child nie zdazy zewaluowac isLoggedIn/token w stanie logged-out podczas wymiany.
  //
  // Dlaczego BEZ dodatkowego stanu `hydrated`/`hadAuthCodeAtFirstPaint`: poniewaz
  // odczyt kodu i setAuthCodePending(true) dzieja sie w layout-effekcie (pre-paint),
  // `authCodePending` JEST juz jedynym, wystarczajacym sterownikiem bramki w pierwszej
  // malowanej klatce — osobna flaga „hydrated" tylko powielalaby ten sam sygnal
  // (martwy term). Timing (layout-effect, nie passive) jest tym, co naprawia DOM,
  // nie wyciszenie ostrzezenia.
  const [authCodePending, setAuthCodePending] = useState<boolean>(false);

  // Czytamy URL raz, na mount (deps `[]`): authCode istnieje tylko na pierwszym
  // poscie-login redirect i jest natychmiast scrubowany — kolejne rendery nie maja
  // go ponownie. `setAuthCodePending` to stabilny setter useState (nie wymaga deps).
  // Brak kodu => bramka zostaje otwarta (false) => common-path renderuje children
  // identycznie jak SSR (zero mismatch).
  useIsomorphicLayoutEffect(() => {
    if (readAuthCodeFromUrl() !== null) {
      setAuthCodePending(true);
    }
  }, []);
  // React Strict Mode (dev) double-invokes effects; an in-flight exchange must
  // not fire twice and burn the single-use code before the first call resolves.
  const exchangeStartedRef = useRef(false);

  // Shared tail of every accepted fresh login (no gate needed, or "Tak"): the
  // token is already persisted by the caller.
  const completeFreshLogin = useCallback(async () => {
    // Rehydrate Better Auth session so useSession() data (→ accountType,
    // role_id) reflects the new identity, and re-enable the currentUser
    // query now that the token exists.
    //
    // DECISION (nie usuwaj tego komentarza):
    // We call refetchSession() (the reactive atom's refetch), NOT
    // authClient.getSession(). getSession() is an imperative proxy fetch
    // whose /get-session path is NOT in the $sessionSignal atomListeners
    // matcher (better-auth 1.6.3 client/config.mjs), so it does NOT update
    // the reactive useSession() atom — the destructured `session` would
    // stay STALE null, and the idle-expiry guard would then bounce this
    // perfectly-valid fresh login to /user/login. refetch() writes the
    // atom via value.set() (client/query.mjs), so post-exchange the
    // reactive session is populated BEFORE the guard re-runs.
    try {
      await refetchSession();
    } catch {
      // Network hiccup — session will hydrate on the next natural fetch;
      // the token is already stored so the user is effectively logged in.
      // The guard's sessionWasNonNullRef bootstrap-window protection keeps
      // this fresh login from being bounced even if this refetch failed.
    }
    await queryClient.invalidateQueries({
      queryKey: queryKeys.account.current,
    });
    setIsLoggedIn(true);
  }, [queryClient, refetchSession]);

  // s34 login-CSRF gate (state, in-memory token, "Tak" / "Nie").
  const {
    loginConfirmation,
    holdForConfirmation,
    confirmFreshLogin,
    rejectFreshLoginAndReload,
  } = useLoginConfirmationGate(completeFreshLogin);

  useSessionRecovery({
    hasSession: session !== null && session !== undefined,
    isFetching: sessionPending,
    hasError: sessionError !== null && sessionError !== undefined,
    errorStatus:
      typeof sessionError?.status === 'number' ? sessionError.status : null,
    isHeldByLoginFlow: authCodePending || loginConfirmation !== null,
    isLoggedIn,
    refetchSession,
  });

  useEffect(() => {
    if (!authCodePending || exchangeStartedRef.current) {
      return;
    }
    exchangeStartedRef.current = true;

    const authCode = readAuthCodeFromUrl();
    if (authCode === null) {
      // Defensive: gate was on but the param vanished (e.g. already scrubbed).
      setAuthCodePending(false);
      return;
    }

    // Snapshot BEFORE the exchange (token presence + "login started here").
    const signals = captureFreshLoginSignals();

    void (async () => {
      try {
        // DECISION (nie usuwaj tego komentarza):
        // AWAIT the exchange. It RETURNS the bearer and does NOT persist it
        // (exchangeAuthCode_IO → captureResponseAuthorization). Since s34
        // (login-CSRF, verified end to end in QA) an exchanged code is no longer
        // trusted as "this user's own fresh login": it proves only that SOMEONE
        // finished a login, and an attacker can hand his own `?authCode` URL to
        // a victim, whose every later upload and CRM note would land in his
        // account. The zero-cookie product has no state cookie to bind the
        // login to this browser, so (option b, owner delegation 2026-09-25):
        //   • valid "login started here" marker AND no existing token → persist
        //     now and continue exactly as before the fix;
        //   • otherwise → keep the token in memory, fetch the e-mail with it as
        //     an explicit Bearer and hold the app behind "Logujesz się jako …".
        //     Storage (a previous session included) is untouched until "Tak",
        //     so a reload or another tab never runs as the unconfirmed account.
        // Rule, marker and the reload-without-answer consequence:
        // application/auth/login-confirmation.ts. (Admin become-user is opaque
        // and orchestrated out-of-band; it never appends ?authCode, so it is
        // not affected here.)
        const token = await exchangeAuthCode_IO(authCode);
        if (token !== null) {
          clearLoginStarted();
          if (needsLoginConfirmation(signals)) {
            // Resolves only after the confirmation state is set, i.e. BEFORE
            // the fallback gate opens below: the app tree never gets a frame.
            await holdForConfirmation(token, signals.hadPreviousToken);
          } else {
            persistSessionToken(token);
            await completeFreshLogin();
          }
        }
        // On failure (token === null) we fall through: no token stored, children
        // mount logged-out, the route guard bounces to /user/login gracefully —
        // identical to arriving with no authCode at all.
      } finally {
        // Scrub the one-time code from the URL (locale prefix + other params
        // preserved) and open the gate so the app renders.
        scrubAuthCodeFromUrl();
        setAuthCodePending(false);
      }
    })();
  }, [authCodePending, completeFreshLogin, holdForConfirmation]);

  // Local-only logout teardown: abort in-flight requests, clear the query cache,
  // drop client tokens, flip logged-out state, and hard-nav to login. Does NOT
  // hit the backend — the caller decides whether server-side revocation is needed
  // first (logout() awaits signOut() before calling this; the cross-tab storage
  // handler calls it directly because another tab already revoked).
  // Identity teardown WITHOUT navigation: abort in-flight work, drop the cached
  // identity, flip logged-out. Shared by the full local logout below and by the
  // out-of-band token-cleared listener (which must NOT navigate — the event
  // pipeline owns that redirect and its `?from=` deep-link).
  const clearIdentityState = useCallback(() => {
    // Abort in-flight requests so they don't resolve against the cleared token
    // (the AppDrawer call-site does not cancelQueries itself).
    requestCancellationService.cancelAll();
    // Centralized cache teardown — every call-site (AppDrawer included) gets
    // cancel + clear for free, no need to wrap logout() at the call-site.
    void queryClient.cancelQueries();
    queryClient.clear();
    setIsLoggedIn(false);
  }, [queryClient]);

  const localLogoutTeardown = useCallback(() => {
    clearIdentityState();
    clearTokens();
    // Navigate to login (works in both SPA and SSR contexts). Use replace(),
    // NOT href: the authed /app shell we are leaving must be dropped from
    // history so a post-logout back-tap can't return to the now-stale
    // authenticated view. Teardown already cleared tokens/cache, so there is
    // nothing on this page worth keeping in the back stack.
    if (typeof window !== 'undefined') {
      // D6: stay in the language the user was using — `/en/app/...` logs out to
      // `/en/user/login`, the default locale stays unprefixed.
      const locale = readLocalePrefix(window.location.pathname);
      // Tokens are already gone: a leave guard's beforeunload prompt here
      // (upload, admin editors) would let „Zostań" keep the page alive over a
      // dead session (leave-guard.ts bypassLeaveGuard).
      bypassLeaveGuard();
      window.location.replace(
        `${locale ? `/${locale}` : ''}${ROUTES_FRONT.USER_LOG}`
      );
    }
  }, [clearIdentityState]);

  // DECISION (nie usuwaj tego komentarza):
  // OUT-OF-BAND TOKEN CLEAR (same-tab). The transport-level teardown
  // (auth-token-teardown) drops the session token the moment the SERVER refuses
  // it — which also removes the precondition of the idle-expiry guard below
  // (`getToken() !== null`), so without this listener the cache would keep
  // serving the previous identity's data behind a stale `isLoggedIn === true`.
  // The browser's `storage` event never fires in the tab that wrote the change,
  // hence this explicit same-tab signal (sibling of the cross-tab listener
  // above). We only clear STATE: the event pipeline performs the redirect, and it
  // is the only layer that knows the `?from=` deep-link to preserve — navigating
  // here too would race two targets and lose the deep-link.
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const handleTokenCleared = () => clearIdentityState();
    window.addEventListener(AUTH_TOKEN_CLEARED_EVENT, handleTokenCleared);
    return () =>
      window.removeEventListener(AUTH_TOKEN_CLEARED_EVENT, handleTokenCleared);
  }, [clearIdentityState]);

  const logout = useCallback(() => {
    // DECISION (nie usuwaj tego komentarza):
    // ORDERING IS LOAD-BEARING — server-side revocation MUST run with the bearer
    // token STILL in storage, BEFORE clearTokens() and BEFORE the hard-nav.
    //
    // Why: Better Auth's signOut() resolves its Authorization header lazily — the
    // @better-fetch `auth: { type:'Bearer', token: () => getFromClientStorage(...) }`
    // resolver runs inside `await getAuthHeader()` (a microtask), NOT synchronously
    // at call time. If we fired `void signOut()` and immediately ran clearTokens()
    // (sync), the resolver microtask would read an already-cleared token ('') → the
    // request would go out WITHOUT Authorization → backend can't map it → the DB
    // session row is NEVER deleted (leaked token stays valid until natural expiry).
    // A synchronous `window.location.href` would additionally cancel the in-flight
    // fetch. So we AWAIT signOut() first (token present during header resolve),
    // THEN tear down + navigate (localLogoutTeardown). Mirrors
    // useGdprErase.clearSessionAndGoHome.
    //
    // Best-effort + bounded: signOut() is raced against a short timeout so a slow/
    // unreachable backend can never hang the logout — but the request is still
    // DISPATCHED (token sent) before we move on, and any failure is swallowed (the
    // local teardown below is the authoritative client-side logout regardless).
    void (async () => {
      try {
        await Promise.race([
          signOut(),
          new Promise<void>(resolve => {
            setTimeout(resolve, 2500);
          }),
        ]);
      } catch {
        // best-effort — local cleanup below is the authoritative logout.
      }
      // Drop client tokens + flip logged-out state (AFTER the token has been sent
      // to /sign-out above, so revocation actually reaches the backend).
      localLogoutTeardown();
    })();
  }, [localLogoutTeardown]);

  // DECISION (nie usuwaj tego komentarza):
  // Cross-tab session revoke propagation (defense-in-depth UX). When the user
  // logs out another device / "all sessions" (SessionsTab) or an admin bans the
  // account, the auth token is cleared from storage. The `storage` event fires
  // ONLY in OTHER tabs of the same origin (never the tab that wrote the change),
  // which is exactly the cross-tab signal we want. If the authorization token
  // key was removed/changed AND no token remains in storage, we tear down the
  // authenticated shell instead of rendering stale accountType until the next
  // backend 401. This is a UX nicety only — the backend already rejects a revoked
  // token on the next call regardless; we never trust storage as the security
  // boundary.
  //
  // DECISION (nie usuwaj tego komentarza):
  // We run localLogoutTeardown() here, NOT the full logout(). This tab did NOT
  // initiate the revocation — another tab (or admin) already cleared the token,
  // which is WHY this storage event fired. Re-running logout()'s signOut()
  // round-trip would be doubly pointless: (1) the revoke already happened in the
  // originating tab, and (2) the token is ALREADY gone from storage (getToken()
  // === null is this branch's trigger), so signOut()'s lazy Bearer resolver would
  // send a request with an empty Authorization header — the backend can't map it
  // and it is a wasted 2.5s-bounded fetch. Local teardown (clear cache + tokens +
  // nav) is the correct, sufficient response in a tab that never held the revoke
  // responsibility.
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const handleStorage = (e: StorageEvent) => {
      if (e.key === CUSTOM_HEADERS.authorization && getToken() === null) {
        localLogoutTeardown();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [localLogoutTeardown]);

  // DECISION (nie usuwaj tego komentarza):
  // Idle-expiry reactive guard (defense-in-depth UX). Session invalidation is
  // otherwise purely reactive to a backend 401 on the next fetch/nav, so an idle
  // user sitting on /app with an expired token (the token STRING is still in
  // storage, but Better Auth `useSession()` resolves data === null) lingers on
  // the authenticated shell until they next hit the network. This guard closes
  // that gap with NO extra network call — it reuses the already-mounted session
  // hook and triggers logout() the moment the session is DEFINITIVELY settled as
  // null while a token is still present.
  //
  // Guard ordering is critical to avoid a false bounce of a perfectly valid
  // session that simply hasn't hydrated yet:
  //   • authCodePending  → variant-C exchange in flight; the session is about to
  //                        arrive, the token may not even be stored yet. NEVER
  //                        bounce here.
  //   • sessionPending   → useSession() has not settled; data === null during
  //                        load is "unknown", not "invalid". Wait.
  //   • !token           → genuinely logged out (no token) — nothing to clear,
  //                        the normal logged-out flow handles routing.
  //   • !sessionWasNonNull → BOOTSTRAP-WINDOW PROTECTION (defense-in-depth). A
  //                        fresh login (magic-link/OAuth exchange OR dev-login)
  //                        races: the useSession() atom settles `data:null` with
  //                        an EMPTY bearer BEFORE the token is stored, then we
  //                        store the token + refetch the atom. Between the gate
  //                        flipping open and that refetch landing, `session` can
  //                        still read the STALE null while a token IS present —
  //                        the exact shape that used to trip this guard and bounce
  //                        a just-logged-in user. We therefore only treat null as
  //                        an EXPIRY once the session has been observed non-null at
  //                        least once since mount. This holds even if refetch is
  //                        slow or fails: the fresh login is never bounced. It does
  //                        NOT weaken the real case — genuine idle-expiry means the
  //                        session WAS non-null (user was logged in) and then turned
  //                        null, so sessionWasNonNullRef is already true and the
  //                        guard fires exactly as before.
  // Only when the session is settled (!sessionPending) AND null AND a token is
  // still present AND we are NOT mid-authCode-exchange AND the session has been
  // real at least once do we treat it as an invalid/expired session and run
  // logout() (clears tokens + redirects to USER_LOG). logout() flips
  // isLoggedIn=false and hard-navigates, so this cannot loop. This subsumes the
  // looser isLoggedIn=token-string signal.
  useEffect(() => {
    // loginConfirmation: the s34 gate owns the session while it is up. On
    // "Nie, to nie ja" signOut() flips the session atom and it refetches; a
    // logout() fired from here would race the reload and could wipe the
    // PREVIOUS token, which the gate deliberately never touches.
    if (authCodePending || sessionPending || loginConfirmation !== null) {
      return;
    }
    if (
      session === null &&
      getToken() !== null &&
      sessionWasNonNullRef.current
    ) {
      logout();
    }
    // DECISION (nie usuwaj tego komentarza):
    // `isLoggedIn` is DELIBERATELY NOT in this deps array. The reactive driver of
    // this guard is `session` (Better Auth atom) — `isLoggedIn` is never read in
    // the effect body, so it is not a dependency (adding it would be a spurious
    // exhaustive-deps appeasement that re-runs the guard on every login/logout
    // for no logical reason). It would also be the wrong correctness lever: a
    // FRESH login flips `setIsLoggedIn(true)` (authCode branch) while `session`
    // can still read STALE null for a tick before refetchSession() lands —
    // re-running on the `isLoggedIn` edge in that window is exactly the shape that
    // would bounce a just-logged-in user. The login-time misfire is prevented
    // structurally by `sessionWasNonNullRef.current` (false until a real session
    // is observed), NOT by the deps list. Token presence is read imperatively via
    // getToken() (live storage read, intentionally not a reactive dep).
  }, [authCodePending, sessionPending, session, logout, loginConfirmation]);

  // DECISION (nie usuwaj tego komentarza):
  // `isLoggedIn` to useState SEEDOWANY RAZ na mount z getToken() i NIE jest
  // reaktywny na zapis tokenu w storage w TYM SAMYM tabie (event `storage` leci
  // tylko do INNYCH tabów). Gałąź variant-C exchange powyżej flipuje go przez
  // setIsLoggedIn(true) WEWNĄTRZ tego providera, ale dev quick-login stempluje
  // token przez http.interceptor w osobnym module (useLoginFlows) i robi SPA
  // router.push BEZ remountu providera — zostawiłby `isLoggedIn` stale=false, a
  // drawer/header pokazałby "Zaloguj się" mimo ważnego tokenu i poprawnej sesji.
  // Ten imperatywny re-sync pozwala takim kanałom token-stamp pogodzić
  // `isLoggedIn` z faktycznym tokenem zaraz po stamp. (become-user NIE potrzebuje
  // tego: admin wchodzi w impersonację już z isLoggedIn=true, flaga się nie zmienia.)
  const syncLoggedInFromStorage = useCallback(() => {
    setIsLoggedIn(getToken() !== null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      isLoggedIn,
      accountType,
      logout,
      syncLoggedInFromStorage,
      loginConfirmation,
      confirmFreshLogin,
      rejectFreshLoginAndReload,
    }),
    [
      isLoggedIn,
      accountType,
      logout,
      syncLoggedInFromStorage,
      loginConfirmation,
      confirmFreshLogin,
      rejectFreshLoginAndReload,
    ]
  );

  return (
    <AuthContext.Provider value={value}>
      {authCodePending ? <AuthCodeBootstrapFallback /> : children}
    </AuthContext.Provider>
  );
}

// DECISION (nie usuwaj tego komentarza):
// While the variant-C authCode exchange is in flight we render this neutral
// full-viewport placeholder INSTEAD of `children`, so no page/guard mounts and
// evaluates isLoggedIn against a not-yet-exchanged token (the timing race).
// It is deliberately framework-free (inline styles, no i18n, no design-system
// import) because it must render before any provider below AuthProvider — and
// it only flashes for the ~1 round-trip duration of the exchange on the single
// post-login redirect. The spinner keyframe is inlined (self-contained, no
// CSS-module dependency). `aria-busy` announces the transient state.
//
// DECISION (nie usuwaj tego komentarza):
// THEME-FLASH SAFE. Tlo uzywa `--color-bg-main`, ktore jest ustawiane
// RENDER-BLOCKING przez ZERO_FLASH_SCRIPT w _document.tsx (czyta localStorage,
// ustawia data-theme/data-mode na <html> ZANIM React zhydratuje), wiec token jest
// rozwiniety na :root juz przed pierwszym paintem — bez czekania na
// ThemeProviderComposition (montuje sie PONIZEJ AuthProvider). Fallbacki var()
// celowo NIE sa jasnym literalem (#faf8f4 zapalal sie na bialo userom w dark
// mode gdyby kaskada kiedykolwiek nie rozwinela tokenu): tlo spada do `transparent`
// (przebija przez nie poprawne tlo <body>, ktore tez czyta --color-bg-main), a kolor
// (zrodlo `currentColor` spinnera) spada do dziedziczonego `currentColor`. W obu
// trybach kontrast i tlo sa wiec poprawne nawet w skrajnym przypadku nierozwinietego
// tokenu — zero bialego mignieca w dark.
function AuthCodeBootstrapFallback() {
  return (
    <div
      aria-busy='true'
      aria-live='polite'
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-bg-main, transparent)',
        color: 'var(--color-text-primary, currentColor)',
        zIndex: 9999,
      }}>
      <span
        aria-hidden='true'
        style={{
          width: 28,
          height: 28,
          borderRadius: 'var(--style-radius-round)',
          border:
            '2px solid color-mix(in oklch, currentColor 24%, transparent)',
          borderTopColor: 'currentColor',
          animation: 'authCodeBootstrapSpin 0.7s linear infinite',
          opacity: 0.55,
        }}
      />
      <style>{`@keyframes authCodeBootstrapSpin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Access auth state (isLoggedIn, accountType, logout, syncLoggedInFromStorage).
 * Must be used within `<AuthProvider>`.
 */
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

/**
 * Returns the current authenticated user from Better Auth session.
 * Uses Better Auth's useSession hook for reactive session state.
 */
export function useCurrentUser() {
  const { data: session, isPending } = authClient.useSession();
  return { user: session?.user, isLoading: isPending };
}

/**
 * Whether to surface authenticated ACCOUNT chrome (avatar + dropdown, "go to
 * panel" CTA) in PUBLIC surfaces (header / mobile bar / drawer).
 *
 * DECISION (nie usuwaj tego komentarza):
 * `isLoggedIn` alone is the WRONG gate here — it is token-PRESENCE only
 * (useState seeded from getToken()), so it stays `true` for a STALE token whose
 * backend session is already dead (expired, or wiped by a dev DB reseed). That
 * produced a real bug (S37 repro): the header painted an avatar for a stale
 * token, and clicking "Idź do panelu" navigated to /app, whose first authed
 * query 401s → LOGIN_FIRST → bounce to /user/login?from=/app. The user looked
 * logged-in but every account action dead-ended at the login screen.
 *
 * We therefore ALSO require the Better Auth session not to be SETTLED invalid:
 *   • session pending  → optimistically TRUE (token present, avoids a
 *                        login→avatar flicker for a valid returning visitor; the
 *                        common case must be flicker-free).
 *   • session === null AND !pending → stale/expired token → FALSE → the public
 *                        chrome shows the login CTA instead of a lying avatar.
 * Both fresh-login channels (variant-C authCode exchange AND dev quick-login)
 * call refetchSession() right after stamping the token, so a genuine login
 * populates the session atom and this returns true without flicker. This gate is
 * UI-only chrome — it never weakens the idle-expiry guard or the security
 * boundary (the backend still 401s a revoked token regardless).
 */
export function useHasLiveAccountSession(): boolean {
  const { isLoggedIn } = useAuth();
  const { data: session, isPending, error } = authClient.useSession();
  // „Nie udało się zapytać” to nie „sesja nieważna”: przy błędzie sieci lub
  // backendu token może być dobry, a ponawianie (useSessionRecovery) przełącza
  // `isPending` tam i z powrotem. Bez tego rozróżnienia awatar w nagłówku
  // migałby przy każdej próbie. 401 jest odpowiedzią, nie awarią.
  const HTTP_UNAUTHORIZED = 401;
  const couldNotAsk =
    error !== null && error !== undefined && error.status !== HTTP_UNAUTHORIZED;
  const sessionSettledInvalid = !isPending && session === null && !couldNotAsk;
  return isLoggedIn && !sessionSettledInvalid;
}
