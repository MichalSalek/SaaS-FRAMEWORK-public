import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { I18N_CONFIG } from '@kernel/domain/i18n/i18n.config';
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
 * DD2-D7: Parse the `from` query string. The pipeline orchestrator sets this
 * when redirecting unauthenticated traffic from a protected route, so we can
 * deliver the user back to the page they originally wanted after login.
 *
 * Hardening:
 * - Reject anything that doesn't look like a local app path (must start with
 *   "/" and NOT "//" to block protocol-relative open-redirects). Checked on the
 *   RAW candidate so "//evil.com" / "http://evil.com" are still rejected.
 * - Reject paths that themselves point at /user/login to avoid login-loop. The
 *   pipeline stores window.location.pathname into `from`, which on an i18n route
 *   carries the locale prefix (e.g. /pl/user/login), so we strip the leading
 *   /<locale> segment BEFORE the comparison — otherwise a locale-prefixed login
 *   path slips past the guard and bounces the user straight back to login.
 * The returned value is the RAW candidate (locale prefix preserved) so the user
 * lands on their own locale. Fallback: ROUTES_FRONT.APP (default dashboard UX).
 *
 * Desktop ≥1280 (PREVIEW/PROD, plain user): the /app fallback is INTENTIONALLY
 * kept here — useDesktopRedirectGuard re-routes bare /app for a logged-in user
 * to ROUTES_FRONT.USER_ACCOUNT at the single bounce point (owner 2026-07-10,
 * DECISION in resolveDesktopBounceDecision). Do NOT special-case desktop in
 * this resolver — it is pure/query-only and shared with useLoggedInRedirectGuard.
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
    candidate.startsWith('/') &&
    !candidate.startsWith('//') &&
    !stripLocalePrefix(candidate).startsWith(ROUTES_FRONT.USER_LOG);
  return isSafe ? candidate : ROUTES_FRONT.APP;
}

// SSOT-derived prefix of the public stylist profile route ('/stylist/'),
// drift-proof if STYLIST_PROFILE ever changes.
const STYLIST_PROFILE_PREFIX = ROUTES_FRONT.STYLIST_PROFILE.split('[')[0];

/**
 * S62: true when the visitor reached login FROM a public stylist profile
 * (`?from=/stylist/<id>`) — i.e. they tapped a client-only action there
 * ("Poproś o połączenie" / bookmark) as a guest. Lets the page surface
 * pairing-context copy instead of the generic stylist-oriented header, so the
 * client understands why they are logging in. Locale-agnostic (strips
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
  if (!candidate.startsWith('/') || candidate.startsWith('//')) {
    return false;
  }
  return stripLocalePrefix(candidate).startsWith(STYLIST_PROFILE_PREFIX);
}

/**
 * Wave F (F1-01): when a marketing CTA hands the user off to login with the
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
 * Wave W3 (web-login-first): customer-facing display name for the plan a
 * visitor picked on /pricing, for the plan-aware login banner ("Wybrałeś
 * plan {plan} …"). Returns null when there is no plan in the funnel, so the
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
 * Kategorie błędów logowania, dla których strona ma osobną treść. Klucz jest
 * zarazem sufiksem klucza i18n (`pages.login.authError.<kategoria>`), więc
 * dodanie kategorii bez tłumaczenia wyłapie test parytetu i18n.
 */
export type AuthErrorKey =
  | 'accountNotLinked'
  | 'sessionExpired'
  | 'cancelled'
  | 'providerNoEmail'
  | 'signupDisabled'
  | 'nativeUnavailable'
  | 'generic';

/**
 * Mapa surowych kodów błędu doklejanych do `?error=` przez Better Auth
 * (`redirectOnError`) oraz przez nasz własny wrapper natywnego OAuth.
 * Nieznany kod celowo NIE jest wypisywany użytkownikowi — wpada do kategorii
 * `generic`, żeby ekran logowania nigdy nie pokazywał surowego identyfikatora
 * z biblioteki.
 */
const AUTH_ERROR_MAP: Readonly<Record<string, AuthErrorKey>> = {
  account_not_linked: 'accountNotLinked',
  state_mismatch: 'sessionExpired',
  invalid_callback_request: 'sessionExpired',
  invalid_code: 'sessionExpired',
  no_code: 'sessionExpired',
  invalid_token: 'sessionExpired',
  access_denied: 'cancelled',
  email_not_found: 'providerNoEmail',
  unable_to_get_user_info: 'providerNoEmail',
  signup_disabled: 'signupDisabled',
  new_user_signup_disabled: 'signupDisabled',
  native_login_unavailable: 'nativeUnavailable',
};

/**
 * Zamienia `?error=<kod>` na kategorię komunikatu. Zwraca null, gdy w adresie
 * nie ma żadnego błędu — wtedy strona logowania wygląda jak zwykle.
 *
 * DLACZEGO TO ISTNIEJE (incydent 2026-08-17): nieudane logowanie Google
 * (`account_not_linked`) odsyłało użytkownika na ten ekran z kodem w adresie,
 * którego strona w ogóle nie czytała. Efekt: „kliknąłem Google, wybrałem konto
 * i wróciłem na logowanie" bez jednego słowa wyjaśnienia, w dodatku w
 * zewnętrznej przeglądarce, z aplikacją zostawioną w tle.
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
 * True, gdy ten ekran logowania jest wyświetlany w ZEWNĘTRZNEJ przeglądarce
 * otwartej przez natywną aplikację (marker `?nativeAuth=1` ustawiany przez
 * backendowy wrapper `native-oauth-start` jako adres błędu OAuth).
 *
 * Wtedy użytkownik nie ma jak wrócić do aplikacji: karta przeglądarki nie
 * należy do niej, a cofanie kończy się dopiero zamknięciem przeglądarki.
 * Strona podaje mu wprost odnośnik `nailfolio://app`, który przenosi go z
 * powrotem (kliknięcie = gest użytkownika, więc przeglądarka wykona skok do
 * aplikacji, czego nie zrobiłaby dla przekierowania 302).
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
