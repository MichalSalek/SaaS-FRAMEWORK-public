import { APP_EVENTS } from './app-events.const';
import type { EVENT_INFO_TYPE } from '../commands-and-queries/cqrs.types';

/**
 * SSOT: Which events trigger application state side-effects.
 * The event pipeline orchestrator reads this config dynamically.
 * To add a new state effect → add event here. No frontend changes needed.
 */
export const EVENT_PIPELINE_CONFIG = Object.freeze({
  /**
   * FULL_RESET: Clear user slice + go-back history.
   * Use for: session-ending events where user context becomes invalid.
   */
  STATE_FULL_RESET: [
    APP_EVENTS.INFO.USER.LOGIN_FIRST,
    APP_EVENTS.INFO.SESSION.SESSION_EXPIRED,
    APP_EVENTS.INFO.USER.USER_LOGGED_OUT,
    APP_EVENTS.INFO.USER.USER_DELETED_SELF,
    APP_EVENTS.INFO.USER.USER_DISABLED_SELF,
    // USER_DISABLED (backend 403 for an inactive state): clear the currentUser cache on eviction so
    // a half-broken shell with the banned user's data unmounts. Full rationale:
    // CRITICAL_REDIRECTIONS_ON_EVENTS.
    APP_EVENTS.INFO.USER.USER_DISABLED,
  ] as readonly EVENT_INFO_TYPE[],

  /**
   * GOBACK_RESET: Clear only go-back navigation history.
   * Use for: context-switching events where user stays authenticated.
   */
  STATE_GOBACK_RESET: [
    APP_EVENTS.INFO.USER.USER_LOGGED_IN,
    APP_EVENTS.INFO.USER.ALREADY_LOGGED,
    APP_EVENTS.INFO.ADMIN.USER_SWITCHED_BACK_TO_SELF,
    APP_EVENTS.INFO.ADMIN.USER_BECAME_SOMEONE_ELSE,
  ] as readonly EVENT_INFO_TYPE[],

  /**
   * AUTH_TOKEN_INVALIDATING: the server ANSWERED and refused the presented credentials, so the
   * bearer token in client storage is provably dead. Consumed by the HTTP error interceptor
   * (auth-token-teardown), NOT by the event pipeline: the teardown compares the REJECTED token with
   * the one in storage, and only the transport layer knows which token went out.
   *
   * DECISION: LOGIN_FIRST is the precise signal (the backend emits it only when the credentials map
   * to no user). UNAUTHORIZED is NOT here: the token is valid but lacks a permission, so clearing it
   * would log out a legitimate user. USER_DISABLED keeps its token (own recovery flow).
   * SESSION_EXPIRED is reserved in the backend union and never emitted today, same semantics.
   * AUTH_UNAVAILABLE (503) is NOT here: the server could not CHECK the token, so it is presumed
   * valid; clearing it turned a database blip into a forced logout.
   */
  AUTH_TOKEN_INVALIDATING: [
    APP_EVENTS.INFO.USER.LOGIN_FIRST,
    APP_EVENTS.INFO.SESSION.SESSION_EXPIRED,
  ] as readonly EVENT_INFO_TYPE[],

  /**
   * UNCONDITIONAL redirects — always fire, skip permission check.
   * All other critical redirects check hasRoutePermission first.
   */
  REDIRECT_UNCONDITIONAL: [
    APP_EVENTS.INFO.SESSION.SESSION_EXPIRED,
    APP_EVENTS.INFO.USER.PLATFORM_GATE,
    // USER_DISABLED: a banned/inactive user with a valid token still HAS the RBAC permissions of
    // their role, so the conditional permission check would skip the redirect on the /app/* routes of
    // that role. UNCONDITIONAL forces the eviction regardless of RBAC.
    APP_EVENTS.INFO.USER.USER_DISABLED,
  ] as readonly EVENT_INFO_TYPE[],
} as const);
