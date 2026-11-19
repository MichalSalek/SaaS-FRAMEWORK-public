import {
  deleteFromClientStorage,
  getFromClientStorage,
} from '../client-device-storage/clientStorage.possibilities.api';
import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';
import { EVENT_PIPELINE_CONFIG } from '@kernel/domain/events/event-pipeline.config';
import type { EVENT_INFO_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
import { withSessionTokenLock } from './session-token-lock';

const AUTH_TOKEN_INVALIDATING_EVENTS = new Set<EVENT_INFO_TYPE>(
  EVENT_PIPELINE_CONFIG.AUTH_TOKEN_INVALIDATING
);

/**
 * Same-tab notification that the session token was dropped OUT OF BAND (by the
 * transport teardown, not by a user-initiated logout).
 *
 * DECISION: this is an event and not a direct call. AuthContext's idle-expiry guard fires on
 * `session === null && getToken() !== null`; clearing the token here would silence that guard (its
 * precondition disappears) and leave the TanStack cache holding the previous identity plus a stale
 * `isLoggedIn === true`. The browser `storage` event reaches only OTHER tabs, so this is the
 * missing same-tab signal. The listener deliberately does NOT navigate: the event pipeline owns the
 * redirect (it alone knows the `?from=` deep link), so cleanup and navigation do not race.
 */
export const AUTH_TOKEN_CLEARED_EVENT = 'nf:auth-token-cleared';

/** Drop in-memory identity-scoped UI state before logout or impersonation reload. */
export const AUTH_IDENTITY_WILL_CHANGE_EVENT = 'nf:auth-identity-will-change';

export const announceIdentityWillChange = (): void => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AUTH_IDENTITY_WILL_CHANGE_EVENT));
  }
};

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
export const clearAuthChannelTokens = (
  expected?: string | null
): Promise<boolean> =>
  withSessionTokenLock(() => {
    if (
      expected !== undefined &&
      getFromClientStorage({ key: CUSTOM_HEADERS.authorization }) !== expected
    ) {
      return false;
    }
    deleteFromClientStorage({ key: CUSTOM_HEADERS.authorization });
    deleteFromClientStorage({ key: CUSTOM_HEADERS.becomeUser });
    return true;
  });

/** Does this response mean "the server refused the presented credentials"? */
export const isAuthRejection = ({
  event,
  status,
}: {
  event: EVENT_INFO_TYPE | undefined;
  status: number | undefined;
}): boolean => {
  // DECISION: a READABLE event decides alone; the status fallback below is only for a 401 whose
  // body had no event. Running it for every 401 would tear the token down on a logged-in user's
  // role/permission refusal (401 + UNAUTHORIZED).
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

export const tearDownRejectedSessionTokenWithLock = (
  input: RejectedTokenTeardown
): Promise<boolean> =>
  withSessionTokenLock(() => tearDownRejectedSessionToken(input));
