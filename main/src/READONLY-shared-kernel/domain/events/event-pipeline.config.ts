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
    // USER_DISABLED (backend 403 dla nieaktywnego stanu) — wyczyść cache
    // currentUser przy eviction, by pół-zepsuty shell z danymi banned-usera
    // się rozmontował. Pełny rationale: CRITICAL_REDIRECTIONS_ON_EVENTS.
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
   * AUTH_TOKEN_INVALIDATING: the server ANSWERED and refused the presented
   * credentials — the bearer token in client storage is provably dead.
   *
   * Consumed by the HTTP error interceptor (auth-token-teardown), NOT by the
   * event pipeline: the teardown must compare the REJECTED token against the
   * one currently in storage, and only the transport layer knows which token
   * went out with the failed request.
   *
   * DECISION (nie usuwaj tego komentarza):
   * LOGIN_FIRST is the precise signal: backend emits it ONLY when it could not
   * map the presented credentials to a user (`currentUser == null` in
   * request.middleware / routing-permissions.interceptor) — i.e. no token, or a
   * token that no longer resolves. UNAUTHORIZED is deliberately NOT here: it
   * means the token IS valid but lacks a permission / has the wrong account
   * type (common-errors.types), so clearing it would log out a legitimate user
   * who merely hit a forbidden route. USER_DISABLED likewise keeps its token
   * (ban/soft-delete eviction has its own recovery flow).
   *
   * SESSION_EXPIRED is included for future wire-up: it is reserved capacity in
   * the backend union (never emitted today — DECISION in common-errors.types)
   * and no client-side code pushes it, but its semantics are identical (server
   * says the session is gone), so the set stays correct the day it lands.
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
    // USER_DISABLED — banned/inactive user z ważnym tokenem nadal MA permisje
    // RBAC swojej roli, więc conditional-permission-check pominąłby redirect na
    // /app/* trasach jego roli. UNCONDITIONAL wymusza eviction niezależnie od RBAC.
    APP_EVENTS.INFO.USER.USER_DISABLED,
  ] as readonly EVENT_INFO_TYPE[],
} as const);
