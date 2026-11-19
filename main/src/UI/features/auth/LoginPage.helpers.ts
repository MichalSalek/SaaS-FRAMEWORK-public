import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { I18N_CONFIG } from '@kernel/domain/i18n/i18n.config';
import { isSafeRelativePath } from '../../../application/routing/safe-relative-path';
import {
  getPlanDisplayName,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';

// Strips a leading /<locale> segment so login-loop comparisons are
// locale-agnostic. Example: /pl/user/login?x=1 → /user/login?x=1, /en/app → /app.
// Only a known locale segment (pl|en|de) followed by "/" or end-of-path is
// removed; bare paths and non-locale first segments are left untouched. Mirrors
// eventPipeline.orchestrator's stripLocalePrefix (same kernel SSOT of locales).
const LOCALE_SEGMENT_RE = new RegExp(
  `^/(${I18N_CONFIG.locales.join('|')})(?=/|$)`
);
const stripLocalePrefix = (path: string): string =>
  path.replace(LOCALE_SEGMENT_RE, '') || '/';

/**
 * Parse the `from` query string. The pipeline orchestrator sets it when redirecting unauthenticated
 * traffic from a protected route, so the user returns to the page they wanted after login.
 * Hardening:
 * - Reject anything that is not a local app path (must start with "/" and NOT "//", to block
 *   protocol-relative open redirects), checked on the RAW candidate.
 * - Reject paths that point at /user/login (login loop). `from` holds window.location.pathname,
 *   which carries the locale prefix (e.g. /pl/user/login), so /<locale> is stripped BEFORE the
 *   comparison.
 * The returned value is the RAW candidate (locale prefix preserved). Fallback: ROUTES_FRONT.APP.
 * Desktop ≥1280 (PREVIEW/PROD, plain user): the /app fallback is INTENTIONALLY kept here;
 * useDesktopRedirectGuard re-routes bare /app for a logged-in user at the single bounce point
 * (owner, DECISION in resolveDesktopBounceDecision). Do NOT special-case desktop in this resolver:
 * it is pure/query-only and shared with useLoggedInRedirectGuard.
 */
export function resolvePostLoginTarget(
  rawFrom: string | string[] | undefined
): string {
  const candidate =
    typeof rawFrom === 'string'
      ? rawFrom
      : Array.isArray(rawFrom)
        ? (rawFrom[0] ?? '')
        : '';
  if (!candidate) {
    return ROUTES_FRONT.APP;
  }
  const isSafe =
    isSafeRelativePath(candidate) &&
    !stripLocalePrefix(candidate).startsWith(ROUTES_FRONT.USER_LOG);
  return isSafe ? candidate : ROUTES_FRONT.APP;
}

/** A fast submit can precede the static login page's router query hydration. */
export function resolveLoginAttemptTarget(
  renderedTarget: string,
  currentSearch: string
): string {
  return renderedTarget === ROUTES_FRONT.APP
    ? resolvePostLoginTarget(
        new URLSearchParams(currentSearch).get('from') ?? undefined
      )
    : renderedTarget;
}

// SSOT-derived prefix of the public stylist profile route ('/stylist/'),
// drift-proof if STYLIST_PROFILE ever changes.
const STYLIST_PROFILE_PREFIX = ROUTES_FRONT.STYLIST_PROFILE.split('[')[0];

/**
 * True when the visitor reached login FROM a public stylist profile (`?from=/stylist/<id>`), i.e.
 * tapped a client-only action there ("Poproś o połączenie" / bookmark) as a guest. Lets the page
 * show pairing-context copy instead of the generic stylist-oriented header. Locale-agnostic (strips
 * /<locale>) and rejects open-redirect shapes, mirroring resolvePostLoginTarget.
 */
export function isFromStylistProfile(
  rawFrom: string | string[] | undefined
): boolean {
  const candidate =
    typeof rawFrom === 'string'
      ? rawFrom
      : Array.isArray(rawFrom)
        ? (rawFrom[0] ?? '')
        : '';
  if (!isSafeRelativePath(candidate)) {
    return false;
  }
  return stripLocalePrefix(candidate).startsWith(STYLIST_PROFILE_PREFIX);
}

/** Distinguish a message intent from the separate connection request on the same profile. */
export function isFromProfileMessage(
  rawFrom: string | string[] | undefined
): boolean {
  if (!isFromStylistProfile(rawFrom)) {
    return false;
  }
  const target = resolvePostLoginTarget(rawFrom);
  return (
    new URL(target, 'https://local.invalid').searchParams.get('contact') === '1'
  );
}

/**
 * True when the visitor is logging in to RESTORE A CLOSED ACCOUNT: `?from=`
 * points at the recovery screen. Two ways in: the „Przywróć zamknięte konto”
 * row on this page, and the logged-out entry guard, which sends an anonymous
 * visitor of `/app/user/recover` here. The login screen then carries the
 * recovery title and the 90-day explanation, so it IS the logged-out version of
 * that screen (owner: the recovery page stood inside the logged-in
 * account panel for a visitor without a session). Locale-agnostic and closed to
 * open-redirect shapes, like the two resolvers above.
 */
export function isFromAccountRecovery(
  rawFrom: string | string[] | undefined
): boolean {
  const candidate =
    typeof rawFrom === 'string'
      ? rawFrom
      : Array.isArray(rawFrom)
        ? (rawFrom[0] ?? '')
        : '';
  if (!candidate.startsWith('/') || candidate.startsWith('//')) {
    return false;
  }
  return stripLocalePrefix(candidate).startsWith(ROUTES_FRONT.USER_RECOVER);
}

/**
 * When a marketing CTA hands the user off to login with the
 * intent of creating a new account, surface signup-oriented copy instead of
 * the default "log in" framing. Landing CTAs and registration entry points
 * pass `?intent=register` (or `?intent=signup` as a synonym) so the page can
 * adapt without a separate /signup route.
 *
 * Returns true ONLY for the explicit register intent — any other value
 * (including missing) keeps the default sign-in framing.
 */
export function isRegisterIntent(
  rawIntent: string | string[] | undefined
): boolean {
  const value =
    typeof rawIntent === 'string'
      ? rawIntent
      : Array.isArray(rawIntent)
        ? (rawIntent[0] ?? '')
        : '';
  return value === 'register' || value === 'signup';
}

/**
 * Customer-facing display name for the plan a visitor picked on /pricing, for the plan-aware login
 * banner ("Wybrałeś plan {plan} …"). Returns null when there is no plan in the funnel, so the
 * caller can skip the banner entirely.
 *
 * Uses kernel `getPlanDisplayName` (SSOT brand names) — never `String(plan)`,
 * which would leak the raw enum (PRO_PLUS) into copy.
 */
export function resolvePlanBannerName(
  planId: PricingPlan | null | undefined
): string | null {
  return planId != null ? getPlanDisplayName(planId) : null;
}

/**
 * Login error categories that get their own page text. The key is also the i18n key suffix
 * (`pages.login.authError.<category>`), so adding a category without a translation is caught by the
 * i18n parity test.
 */
export type AuthErrorKey =
  | 'accountNotLinked'
  | 'sessionExpired'
  | 'linkExpired'
  | 'cancelled'
  | 'providerNoEmail'
  | 'signupDisabled'
  | 'nativeUnavailable'
  | 'generic';

/**
 * Map of raw error codes appended to `?error=` by Better Auth (`redirectOnError`) and by our own
 * native OAuth wrapper. An unknown code is deliberately NOT shown to the user: it falls into the
 * `generic` category, so the login screen never shows a library identifier.
 */
const AUTH_ERROR_MAP: Readonly<Record<string, AuthErrorKey>> = {
  account_not_linked: 'accountNotLinked',
  // OAuth state (better-auth/dist/state.mjs + oauth2/state.mjs): the state
  // cookie went missing (another browser, an in-app browser of a mail app) or
  // the flow outlived its window. Retrying in THIS browser fixes both.
  state_mismatch: 'sessionExpired',
  state_not_found: 'sessionExpired',
  state_invalid: 'sessionExpired',
  invalid_callback_request: 'sessionExpired',
  invalid_code: 'sessionExpired',
  no_code: 'sessionExpired',
  // Magic link (better-auth/dist/plugins/magic-link): 1.7 sends INVALID_TOKEN
  // for an unknown, used or expired link; EXPIRED_TOKEN / ATTEMPTS_EXCEEDED are
  // the codes of other releases of the plugin, kept so a bump stays readable.
  invalid_token: 'linkExpired',
  expired_token: 'linkExpired',
  attempts_exceeded: 'linkExpired',
  access_denied: 'cancelled',
  email_not_found: 'providerNoEmail',
  unable_to_get_user_info: 'providerNoEmail',
  signup_disabled: 'signupDisabled',
  new_user_signup_disabled: 'signupDisabled',
  native_login_unavailable: 'nativeUnavailable',
};

/**
 * Turns `?error=<code>` into a message category. Returns null when the address has no error, and
 * the login page then looks as usual.
 *
 * WHY IT EXISTS: a failed Google login (`account_not_linked`) sent the user back to this screen with
 * a code in the address that the page never read: "I clicked Google, picked an account and came
 * back to login" with no explanation, in an external browser with the app left in the background.
 */
export function resolveAuthErrorKey(
  rawError: string | string[] | undefined
): AuthErrorKey | null {
  const value =
    typeof rawError === 'string'
      ? rawError
      : Array.isArray(rawError)
        ? (rawError[0] ?? '')
        : '';
  if (!value) {
    return null;
  }
  return AUTH_ERROR_MAP[value.toLowerCase()] ?? 'generic';
}

/**
 * True when this login screen is shown in an EXTERNAL browser opened by the native app (marker
 * `?nativeAuth=1`, set by the backend wrapper `native-oauth-start` as the OAuth error address).
 *
 * The user then has no way back to the app: the browser tab does not belong to it, and going back
 * ends only by closing the browser. The page gives a direct `nailfolio://app` link that jumps back
 * (a click is a user gesture, so the browser performs the jump, unlike for a 302 redirect).
 */
export function isNativeAuthReturn(
  rawNativeAuth: string | string[] | undefined
): boolean {
  const value =
    typeof rawNativeAuth === 'string'
      ? rawNativeAuth
      : Array.isArray(rawNativeAuth)
        ? (rawNativeAuth[0] ?? '')
        : '';
  return value === '1';
}

/** i18n key (pages.login.*) for a refused magic-link send. */
export type MagicLinkSendErrorKey = 'sendRateLimited' | 'sendError';

/**
 * Maps the HTTP status of a refused magic-link send to its message. 429 comes
 * from our own limiter in front of Better Auth (`withRateLimitCheck`), and it
 * is the one refusal where "try again" right away is the wrong advice, so it
 * gets its own copy. Everything else keeps the generic send error.
 */
export function magicLinkSendErrorKey(
  status: number | undefined
): MagicLinkSendErrorKey {
  return status === 429 ? 'sendRateLimited' : 'sendError';
}
