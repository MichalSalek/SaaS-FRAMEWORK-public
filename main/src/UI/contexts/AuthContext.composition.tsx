import { AuthCodeBootstrapFallbackComposition } from './AuthCodeBootstrapFallback.composition';
import { useLocalLogoutTeardown } from './useLocalLogoutTeardown';
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
import { authClient, signOut } from '../../application/auth/better-auth-client';
import { signOutAndForgetPushDevice } from '../../domain/notifications/push/sign-out-with-push';
import { getSessionAccountType } from '../../application/auth/session-fields.helpers';
import {
  readAuthCodeFromUrl,
  scrubAuthCodeFromUrl,
} from '../../application/auth/auth-code.helpers';
import { AUTH_TOKEN_CLEARED_EVENT } from '../../application/auth/auth-token-teardown';
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
  bindDocumentCredentials,
  bindDocumentCredentialsIfCurrent,
  checkedDocumentCredentials,
  currentCredentialsMatch,
  readDocumentCredentials,
} from '../../application/auth/document-credentials';
import { useDocumentCredentialsGuard } from './useDocumentCredentialsGuard';

// ---------------------------------------------------------------------------
// Isomorphic layout effect
// ---------------------------------------------------------------------------

// DECISION: useLayoutEffect does nothing on the server (SSG prerender) and React warns about it, so
// it is aliased to useEffect when `window` is absent: SSR/SSG stays silent while the client keeps
// the SYNCHRONOUS pre-paint timing that the authCode gate below depends on (it closes before
// anything paints logged-in/logged-out and before children's passive guard effects fire).
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
   * Login-CSRF gate: non-null while a fresh ?authCode login waits for the
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
const getToken = () => readDocumentCredentials().authorization;

// DECISION: admin impersonation (BECOME_USER / SWITCH_BACK_BECOME_USER / REFRESH_IMPERSONATION) is
// NOT plumbed through AuthContext. The IO functions in
// `main/src/domain/admin/users/adminUsersIO.possibilities.api.ts` orchestrate the switch, the HTTP
// interceptor persists the become-user/auth tokens out-of-band (CUSTOM_HEADERS), and the switch
// ends in a full document reload (application/auth/identity-switch.ts). The impersonation token is
// opaque and never exposed to React state or logs; `useAppRole.isBecomeUser` derives the flag from
// the presence of CUSTOM_HEADERS.becomeUser in storage, the single source of truth for UI gating
// (ImpersonationBanner).

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthState | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProviderComposition({ children }: AuthProviderProps) {
  // Derive initial logged-in state from token presence
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(() => {
    bindDocumentCredentials();
    return getToken() !== null;
  });

  const queryClient = useQueryClient();

  // Derive accountType from Better Auth session (additionalFields.account_type).
  // Reactive: changes whenever session refreshes (login, logout, role switch).
  // Cast + narrowing centralized in getSessionAccountType helper — it returns
  // `AccountType | null` directly, so no further narrowing is needed here.
  //
  // DECISION: `refetch` is pulled off useSession(). `authClient.getSession()` is an imperative proxy
  // fetch to /get-session whose path is NOT in the better-auth client's `$sessionSignal`
  // atomListeners matcher (client/config.mjs: only /sign-out, /sign-in/email, /update-user, ...), so
  // it never writes the session atom and the reactive `useSession()` data stays STALE after it
  // resolves. `refetch` writes the atom directly, so after a fresh login the reactive atom carries
  // the post-login session before the idle-guard below re-runs.
  const {
    data: session,
    isPending: sessionPending,
    error: sessionError,
    refetch: refetchSession,
  } = authClient.useSession();
  // DECISION: the session is the first source of the active role, not the only one. When the
  // session atom is empty while a token is stored (reason and retry: application/auth/
  // session-recovery.ts), the role comes from the account query, which reads the same `users` row.
  // `null` stays only for "really unknown" and no consumer may draw it as a client.
  const cachedCurrentUser = useCachedCurrentUser();
  const cachedAccountType = isLoggedIn
    ? (cachedCurrentUser?.account_type ?? null)
    : null;
  const accountType: AccountType | null =
    getSessionAccountType(session) ?? cachedAccountType;

  // DECISION: bootstrap-window protection for the idle-expiry guard below. A FRESH login (magic-link
  // or OAuth exchange, or dev-login) starts with NO token, so the useSession() atom settles
  // `data:null` BEFORE the token is stored, and the guard could re-run on that stale null between
  // opening the gate and the refetch landing. This ref records whether the session has EVER been
  // non-null since mount; the guard treats `null` as a real expiry only after that, so a
  // just-logged-in user is never bounced even if the refetch is slow or fails. Genuine idle-expiry
  // (non-null, then null) still trips the guard.
  const sessionWasNonNullRef = useRef(false);
  useEffect(() => {
    if (session !== null && session !== undefined) {
      sessionWasNonNullRef.current = true;
    }
  }, [session]);

  // ── Variant-C post-login token bridge (?authCode=…) ──────────────────────
  // DECISION: TIMING-CRITICAL GATE. After a magic-link/OAuth login the backend redirects to the
  // FRONTEND with `?authCode=<one-time code>` (never the token). The code is exchanged and the
  // token must be in storage BEFORE any guard or query reads it; otherwise the user looks logged
  // OUT and the dashboard/onboarding guard bounces a valid fresh login to /user/login. So the whole
  // child tree (pages, guards, session consumers) is GATED while a code is present; the exchange
  // effect below awaits the exchange, rehydrates the session, then opens the gate. No test asserts
  // the pre-exchange frame; AuthContext.login-confirm.test.tsx covers the confirmation gate.
  //
  // DECISION: the gate is two-phase to stay hydration-identical (reading the URL in the initial
  // state made SSR and client disagree on every magic-link login). Phase 1: init `false`, like SSR.
  // Phase 2: a layout effect (synchronous, BEFORE the first client paint) closes the gate when a
  // code is present, in the same commit, before the logged-out shell paints and before children's
  // passive guard effects (idle-expiry, recovery) run.
  const [authCodePending, setAuthCodePending] = useState<boolean>(false);

  // Read the URL once, on mount (deps `[]`): the authCode exists only on the
  // first post-login redirect and is scrubbed immediately. `setAuthCodePending`
  // is a stable useState setter. No code => the gate stays open and children
  // render exactly as on the server (no mismatch).
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
  const completeFreshLogin = useCallback(
    async (token: string) => {
      const accepted = bindDocumentCredentialsIfCurrent(token);
      if (!accepted) {
        return;
      }
      // Rehydrate Better Auth session so useSession() data (→ accountType,
      // role_id) reflects the new identity, and re-enable the currentUser
      // query now that the token exists.
      //
      // DECISION: call refetchSession() (the reactive atom's refetch), NOT authClient.getSession(): see
      // the refetch DECISION above (getSession leaves the atom stale and the idle-expiry guard would
      // bounce this fresh login).
      try {
        await refetchSession();
      } catch {
        // Network hiccup — session will hydrate on the next natural fetch;
        // the token is already stored so the user is effectively logged in.
        // The guard's sessionWasNonNullRef bootstrap-window protection keeps
        // this fresh login from being bounced even if this refetch failed.
      }
      if (!currentCredentialsMatch(accepted)) {
        return;
      }
      await queryClient.invalidateQueries({
        queryKey: queryKeys.account.current,
      });
      if (!currentCredentialsMatch(accepted)) {
        return;
      }
      setIsLoggedIn(true);
    },
    [queryClient, refetchSession]
  );

  // Login-CSRF gate (state, in-memory token, "Tak" / "Nie").
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
        // DECISION: AWAIT the exchange. It RETURNS the bearer and does NOT persist it
        // (exchangeAuthCode_IO → captureResponseAuthorization). An exchanged code proves only that
        // SOMEONE finished a login: an attacker can hand his own `?authCode` URL to a victim, whose
        // later uploads and CRM notes would land in his account, and the zero-cookie product has no
        // state cookie to bind the login to this browser. So: a valid "login started here" marker
        // AND no existing token → persist now and continue as before; otherwise → keep the token in
        // memory, fetch the e-mail with it as an explicit Bearer and hold the app behind
        // „Logujesz się jako …”. Storage (a previous session included) is untouched until "Tak", so a
        // reload or another tab never runs as the unconfirmed account. Rule, marker and the
        // reload-without-answer consequence: application/auth/login-confirmation.ts. Admin
        // become-user never appends ?authCode, so it is not affected. (owner)
        // Test: main/src/UI/contexts/AuthContext.login-confirm.test.tsx (covers storage untouched
        // until "Tak" and a reload without an answer; not a real second tab).
        const token = await exchangeAuthCode_IO(authCode);
        if (token !== null) {
          clearLoginStarted();
          if (needsLoginConfirmation(signals)) {
            // Resolves only after the confirmation state is set, i.e. BEFORE
            // the fallback gate opens below: the app tree never gets a frame.
            await holdForConfirmation(token, signals.hadPreviousToken);
          } else {
            const saved = await persistSessionToken(token, false);
            if (saved) {
              await completeFreshLogin(token);
            } else {
              await holdForConfirmation(token, true);
            }
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

  const { clearIdentityState, localLogoutTeardown } = useLocalLogoutTeardown(
    queryClient,
    setIsLoggedIn
  );

  // DECISION: OUT-OF-BAND TOKEN CLEAR (same tab). The transport-level teardown (auth-token-teardown)
  // drops the session token the moment the SERVER refuses it, which also removes the precondition
  // of the idle-expiry guard below (`getToken() !== null`); without this listener the cache would
  // keep serving the previous identity's data behind a stale `isLoggedIn === true`. The browser's
  // `storage` event never fires in the tab that wrote the change, hence this explicit same-tab
  // signal. It only clears STATE: the event pipeline performs the redirect and is the only layer
  // that knows the `?from=` deep-link to preserve; navigating here too would race two targets.
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
    const credentials = checkedDocumentCredentials();
    if (!credentials) {
      return;
    }
    const tokenAtLogout = credentials.authorization;

    void (async () => {
      try {
        // The push device is unregistered first (needs the
        // token), then the bounded sign-out; both in sign-out-with-push.ts.
        await signOutAndForgetPushDevice(() =>
          tokenAtLogout
            ? signOut({
                fetchOptions: {
                  auth: { type: 'Bearer', token: tokenAtLogout },
                },
              })
            : Promise.resolve()
        );
      } catch {
        // best-effort — local cleanup below is the authoritative logout.
      }
      // Drop client tokens + flip logged-out state (AFTER the token has been sent
      // to /sign-out above, so revocation actually reaches the backend).
      await localLogoutTeardown(tokenAtLogout);
    })();
  }, [localLogoutTeardown]);

  useDocumentCredentialsGuard({
    loginBlocked: authCodePending || loginConfirmation !== null,
    clearIdentityState,
    localLogoutTeardown,
  });

  // DECISION: idle-expiry reactive guard (defense-in-depth UX). Without it an idle user on /app with
  // an expired token (still in storage, but `useSession()` resolves null) lingers on the
  // authenticated shell until the next 401. It reuses the mounted session hook (no extra call) and
  // runs logout() once the session is DEFINITIVELY null while a token is present. Skip when:
  //   • authCodePending: the exchange is in flight, the token may not be stored yet.
  //   • sessionPending: null during load is "unknown", not "invalid".
  //   • !token: genuinely logged out; the normal logged-out flow routes.
  //   • !sessionWasNonNull: bootstrap window. A fresh login can read a stale null between the gate
  //     opening and the refetch landing; null counts as expiry only after the session has been
  //     non-null once since mount.
  // logout() flips isLoggedIn=false and hard-navigates, so this cannot loop.
  useEffect(() => {
    // loginConfirmation: the login-CSRF gate owns the session while it is up. On
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
    // DECISION: `isLoggedIn` is DELIBERATELY not in this deps array. The reactive driver of the guard
    // is `session` (the Better Auth atom); `isLoggedIn` is never read in the effect body, and
    // re-running on its edge would be the wrong lever: a FRESH login flips `setIsLoggedIn(true)`
    // while `session` can still read a stale null before refetchSession() lands, exactly the shape
    // that would bounce a just-logged-in user. The login-time misfire is prevented structurally by
    // `sessionWasNonNullRef.current`, not by the deps list. Token presence is read imperatively via
    // getToken() (a live storage read, intentionally not a reactive dep).
  }, [authCodePending, sessionPending, session, logout, loginConfirmation]);

  // DECISION: `isLoggedIn` is a useState SEEDED ONCE at mount from getToken() and is not reactive to
  // a token write in the SAME tab (the `storage` event reaches only OTHER tabs). The variant-C
  // exchange flips it via setIsLoggedIn(true) inside this provider, but dev quick-login stamps the
  // token through http.interceptor in a separate module (useLoginFlows) and does a SPA router.push
  // without remounting the provider, which would leave `isLoggedIn` stale=false and the
  // drawer/header showing "Zaloguj się" despite a valid token. This imperative re-sync lets such
  // token-stamp channels reconcile `isLoggedIn` right after the stamp. (become-user does not need
  // it: the admin enters impersonation already logged in.)
  const syncLoggedInFromStorage = useCallback(() => {
    const current = checkedDocumentCredentials();
    if (current) {
      setIsLoggedIn(current.authorization !== null);
    }
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
      {authCodePending ? <AuthCodeBootstrapFallbackComposition /> : children}
    </AuthContext.Provider>
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
 * DECISION: `isLoggedIn` alone is the WRONG gate: it is token PRESENCE only, so it stays `true` for
 * a STALE token whose backend session is dead, and the header would paint an avatar whose every
 * account action dead-ends at login. So the Better Auth session must ALSO not be SETTLED invalid:
 *   • session pending → optimistically TRUE (avoids a login→avatar flicker for a returning visitor).
 *   • session === null AND !pending → stale token → FALSE → the login CTA instead of a lying avatar.
 * Both fresh-login channels call refetchSession() right after stamping the token, so a genuine
 * login returns true without flicker. UI-only chrome: never the security boundary.
 */
export function useHasLiveAccountSession(): boolean {
  const { isLoggedIn } = useAuth();
  const { data: session, isPending, error } = authClient.useSession();
  // "Could not ask" is not "session invalid": on a network or backend error the
  // token may be fine, and the retry (useSessionRecovery) toggles `isPending`
  // back and forth. Without this distinction the header avatar would flicker
  // on every attempt. A 401 is an answer, not a failure.
  const HTTP_UNAUTHORIZED = 401;
  const couldNotAsk =
    error !== null && error !== undefined && error.status !== HTTP_UNAUTHORIZED;
  const sessionSettledInvalid = !isPending && session === null && !couldNotAsk;
  return isLoggedIn && !sessionSettledInvalid;
}
