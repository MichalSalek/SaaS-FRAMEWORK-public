import {
  deleteFromClientStorage,
  getFromClientStorage,
} from '../client-device-storage/clientStorage.possibilities.api';
import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';
import { EVENT_PIPELINE_CONFIG } from '@kernel/domain/events/event-pipeline.config';
import type { EVENT_INFO_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';

/**
 * auth-token-teardown — SSOT for dropping the auth-channel tokens from client
 * storage, plus the guarded teardown of a token the SERVER has just refused.
 *
 * WHY THIS EXISTS (bug 2026-08-31, owner report from the Android wrapper):
 * The session lives as a bearer token in localStorage (zero cookies — the app
 * is a Capacitor WebView). The pre-paint native entry bridge
 * (zero-flash-script.ts) picks the cold-start route by token PRESENCE alone:
 * token → `/app`, no token → `/welcome`. Nothing ever removed a token that had
 * stopped resolving, so a dead token made `/welcome` permanently unreachable:
 * every launch went `/` → `/app` → 401 (LOGIN_FIRST) → `/user/login`. The three
 * places that could have cleared it all miss this shape:
 *   • http.interceptor headers — clears only on an explicit CLEAR command value,
 *     which the backend never sends for `authorization`;
 *   • AuthContext idle-expiry guard — fires only once a session has been
 *     observed non-null and then turned null (`sessionWasNonNullRef`), so a
 *     cold start whose session is null from the first render never trips it;
 *   • event pipeline — redirects, but owns no storage.
 * This module closes that gap at the only layer that can do it safely.
 *
 * DECISION (nie usuwaj tego komentarza):
 * TEARDOWN RUNS ON A SERVER VERDICT, NEVER ON INFERENCE. The trigger is an
 * AUTH_TOKEN_INVALIDATING event (kernel SSOT: LOGIN_FIRST — the backend could
 * not map the presented credentials to a user) or a bare 401 with no readable
 * event. Both mean the server ANSWERED and refused. The tempting alternative —
 * clearing whenever Better Auth's `useSession()` settles null while a token is
 * present — is WRONG and must not be reintroduced: `data: null` also covers
 * "backend unreachable" and "request timed out", so an offline user with a
 * perfectly valid token would be silently logged out. Absence of proof is not
 * proof of a dead token.
 *
 * DECISION (nie usuwaj tego komentarza):
 * WE CLEAR ONLY THE EXACT TOKEN THAT WAS REJECTED (`rejectedAuthorization` vs
 * live storage), which structurally eliminates the fresh-login race: a slow
 * request sent BEFORE a login can land its 401 AFTER the new token was stamped
 * (in-flight retry, StrictMode double-mount, cross-tab login). Comparing values
 * makes that stale verdict a no-op instead of destroying the session the user
 * just obtained. A time-based grace window was considered and rejected — it is a
 * heuristic that fails for any request slower than the window, while the
 * comparison is exact and free (the transport already holds both values).
 *
 * DECISION (nie usuwaj tego komentarza):
 * AN ACTIVE IMPERSONATION IS NEVER TORN DOWN HERE. Admin become-user rides a
 * SEPARATE opaque channel (`become-user` header, HMAC) and the admin's own
 * `authorization` stays valid underneath it. A LOGIN_FIRST caused by a
 * refused/expired impersonation token must NOT drop the admin's session — that
 * would evict them mid-preview instead of letting switch-back restore them. So
 * when a become-user token is present we skip the teardown entirely and leave
 * both channels to the impersonation flow.
 *
 * DECISION (nie usuwaj tego komentarza):
 * NO NATIVE-SPECIFIC REDIRECT HERE (rozważone i ODRZUCONE, cross-model review
 * 2026-08-31). Kierowanie natywnego usera z martwym tokenem wprost na
 * `/welcome` zamiast `/user/login` dodawało trzeci stan (latch „czy widziano
 * żywą sesję") i ryzyko pętli welcome↔app, a zysk był jednorazowy: po
 * wyczyszczeniu tokena pre-paint bridge sam otwiera `/welcome` przy NASTĘPNYM
 * cold-starcie, bo decyduje po obecności tokena. Pierwszy strzał na login jest
 * poprawnym UX (user i tak chce się zalogować). NIE dodawać tego z powrotem bez
 * nowego dowodu.
 */

const AUTH_TOKEN_INVALIDATING_EVENTS = new Set<EVENT_INFO_TYPE>(
  EVENT_PIPELINE_CONFIG.AUTH_TOKEN_INVALIDATING
);

/**
 * Same-tab notification that the session token was dropped OUT OF BAND (by the
 * transport teardown, not by a user-initiated logout).
 *
 * DECISION (nie usuwaj tego komentarza):
 * WHY AN EVENT AND NOT A DIRECT CALL. AuthContext's idle-expiry guard fires on
 * `session === null && getToken() !== null` — clearing the token here would
 * otherwise SILENCE that guard (its precondition disappears) and leave the
 * TanStack cache populated with the previous identity's data plus a stale
 * `isLoggedIn === true`. The browser's own `storage` event only reaches OTHER
 * tabs, so this is the missing same-tab signal, mirroring the cross-tab listener
 * already in AuthContext. The listener deliberately does NOT navigate: the event
 * pipeline owns the redirect (it alone knows the `?from=` deep-link), so state
 * cleanup and navigation stay separated instead of racing two targets.
 */
export const AUTH_TOKEN_CLEARED_EVENT = 'nf:auth-token-cleared';

const announceTokenCleared = (): void => {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new Event(AUTH_TOKEN_CLEARED_EVENT));
};

/** Bearer prefix the transport adds on the wire; storage holds the raw token. */
const BEARER_PREFIX = 'Bearer ';

/**
 * Normalize a token for comparison: the request header carries `Bearer <t>`
 * (http.utils adds it idempotently) while storage may hold either shape
 * (dev-login / become-user stamp raw values). Compare the payload, not the
 * wrapper.
 */
const stripBearer = (value: string): string =>
  value.startsWith(BEARER_PREFIX) ? value.slice(BEARER_PREFIX.length) : value;

/**
 * Drop BOTH auth-channel tokens (session + impersonation). SSOT for logout-shape
 * teardown — AuthContext's logout composes this with its own cache/funnel
 * cleanup, so the key list lives in exactly one place.
 */
export const clearAuthChannelTokens = (): void => {
  deleteFromClientStorage({ key: CUSTOM_HEADERS.authorization });
  deleteFromClientStorage({ key: CUSTOM_HEADERS.becomeUser });
};

/** Does this response mean "the server refused the presented credentials"? */
export const isAuthRejection = ({
  event,
  status,
}: {
  event: EVENT_INFO_TYPE | undefined;
  status: number | undefined;
}): boolean => {
  // DECISION (nie usuwaj tego komentarza): a READABLE event decides alone.
  // The status fallback below is only for a 401 whose body had no event.
  // Before S122 the fallback ran for every 401, so a backend answering a
  // logged-in user's role/permission refusal with 401 + UNAUTHORIZED (the
  // domain error mapper did exactly that for WRONG_ACCOUNT_TYPE) tore the
  // token down: an admin tapping "Polubione" in the drawer was logged out.
  if (event !== undefined) {
    return AUTH_TOKEN_INVALIDATING_EVENTS.has(event);
  }
  // Defense in depth: a 401 whose body carried no readable event (truncated
  // payload, non-JSON gateway response) is still an explicit server refusal.
  // Without this branch such a response fell through to
  // INTERNET_CONNECTION_PROBLEM and the dead token survived — the exact shape
  // that made /welcome unreachable.
  return status === 401;
};

type RejectedTokenTeardown = {
  /** Value of the `authorization` header the failed request actually carried. */
  rejectedAuthorization: string | undefined;
};

/**
 * Clear the session token IFF the server refused THIS token and it is still the
 * live one. Returns whether storage was actually mutated (drives debug logs and
 * makes the guards unit-testable).
 */
export const tearDownRejectedSessionToken = ({
  rejectedAuthorization,
}: RejectedTokenTeardown): boolean => {
  // No credentials went out → nothing was rejected (a plain logged-out visitor
  // hitting a protected route also produces LOGIN_FIRST).
  if (
    rejectedAuthorization === undefined ||
    rejectedAuthorization.trim() === ''
  ) {
    return false;
  }

  // Active impersonation — leave both channels alone (see DECISION above).
  if (getFromClientStorage({ key: CUSTOM_HEADERS.becomeUser }) !== null) {
    return false;
  }

  const storedToken = getFromClientStorage({
    key: CUSTOM_HEADERS.authorization,
  });
  if (storedToken === null) {
    return false;
  }

  // Stale verdict about a token that is no longer the live one (fresh login
  // landed meanwhile) → no-op.
  if (stripBearer(storedToken) !== stripBearer(rejectedAuthorization)) {
    return false;
  }

  deleteFromClientStorage({ key: CUSTOM_HEADERS.authorization });
  // Tell this tab's AuthContext to drop the cached identity + logged-in flag.
  // Without it the token would be gone while the app still rendered the previous
  // user's cached data (the idle-expiry guard can no longer see a token to act
  // on). Navigation stays with the event pipeline — see the DECISION above.
  announceTokenCleared();
  return true;
};
