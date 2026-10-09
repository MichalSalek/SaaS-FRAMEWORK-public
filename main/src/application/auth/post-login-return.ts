// main/src/application/auth/post-login-return.ts
// D6 (2026-09-05): the user stays in the language they logged in from — on every
// channel (magic-link web/native, Google web/native, dev quick-login) and device.
//
// ONE resolver for the Better Auth `callbackURL` / `errorCallbackURL` values:
// it takes the INTERNAL (locale-less) target the login page already computes
// (`/app`, `/app/onboarding?role=stylist`, a validated `?from=` deep link) and the
// locale of the page the login STARTED on (`router.locale`), and returns the path
// Better Auth should 302 to after the verify/callback hop. The bridge (web-1
// auth-token-bridge `buildBridgeRedirectUrl`) preserves pathname+search, the
// nailfolio:// hop maps the path 1:1, and the exchange-code landing stays in place
// (`scrubAuthCodeFromUrl` keeps the prefix) — so the prefix set HERE is the prefix
// the user lands on.
//
// DECISION (nie usuwaj tego komentarza):
// • Prefix ONLY for non-default locales (`/en/app`, `/de/app`); the default locale
//   is served UNPREFIXED by Next (`localeDetection:false`, canonical `/app`) — a
//   `/pl/app` would work but is not canonical and would leak into history/SEO.
// • The login-page locale WINS over a prefix already present in `?from=`: the
//   pipeline stores `window.location.pathname` (which carries the OLD prefix) into
//   `from`, but the user may have switched language on the login screen — the
//   language they SEE while logging in is the one they expect afterwards.
// • `defaultLocale` comes from `router.defaultLocale` (Next's own literal) with the
//   kernel `I18N_CONFIG.defaultLocale` as fallback, so an env-driven kernel default
//   can never invert the prefix rule against Next's canonical.
// • Router navigations (`router.replace`) DO NOT use this helper: Next keeps the
//   current locale for unprefixed hrefs, and passing an already-prefixed href
//   together with `{ locale }` risks a double prefix. Prefixed paths are for
//   Better Auth (a real URL on the wire) only.

import {
  I18N_CONFIG,
  isValidLocale,
  type LocaleType,
} from '@kernel/domain/i18n/i18n.config';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { stripLocalePrefix } from '@kernel/domain/routing/app-path.utils';

export interface LocalizedReturnPathInput {
  /** Internal target, relative (`/app`, `/app/onboarding?role=stylist`). */
  path: string;
  /** `router.locale` of the page the login starts on. */
  locale: string | undefined;
  /** `router.defaultLocale` (Next literal); kernel default when absent. */
  defaultLocale?: string | undefined;
}

/** Relative, same-origin only: `/x` yes, `//evil`, `http://…`, `\\` no. */
const isSafeRelativePath = (path: string): boolean =>
  path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\');

/** Effective locale to prefix with, or null for the default (unprefixed) locale. */
export function resolveReturnLocale({
  locale,
  defaultLocale,
}: Pick<
  LocalizedReturnPathInput,
  'locale' | 'defaultLocale'
>): LocaleType | null {
  const effectiveDefault: LocaleType = isValidLocale(defaultLocale)
    ? defaultLocale
    : I18N_CONFIG.defaultLocale;
  if (!isValidLocale(locale) || locale === effectiveDefault) {
    return null;
  }
  return locale;
}

export function resolveLocalizedReturnPath({
  path,
  locale,
  defaultLocale,
}: LocalizedReturnPathInput): string {
  const safe = isSafeRelativePath(path) ? path : ROUTES_FRONT.APP;
  const bare = stripLocalePrefix(safe);
  const prefix = resolveReturnLocale({ locale, defaultLocale });
  if (prefix === null) {
    return bare;
  }
  return `/${prefix}${bare === '/' ? '' : bare}`;
}
