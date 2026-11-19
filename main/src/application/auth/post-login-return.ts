// main/src/application/auth/post-login-return.ts
// One resolver for the Better Auth `callbackURL` / `errorCallbackURL`: takes the internal
// (locale-less) target the login page computed and the locale the login STARTED on
// (`router.locale`), and returns the path Better Auth should 302 to after the verify/callback hop.
// The bridge keeps pathname+search, so the prefix set HERE is the prefix the user lands on.
//
// DECISION:
// • Prefix ONLY non-default locales (`/en/app`); the default locale is served unprefixed by Next
//   (`localeDetection:false`), and `/pl/app` would leak into history/SEO.
// • The login-page locale WINS over a prefix already in `?from=` (the user may have switched
//   language on the login screen).
// • `defaultLocale` is `router.defaultLocale`, falling back to kernel `I18N_CONFIG.defaultLocale`.
// • Router navigations (`router.replace`) do NOT use this helper: an already-prefixed href plus
//   `{ locale }` risks a double prefix. Prefixed paths are for Better Auth only.

import {
  I18N_CONFIG,
  isValidLocale,
  type LocaleType,
} from '@kernel/domain/i18n/i18n.config';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { stripLocalePrefix } from '@kernel/domain/routing/app-path.utils';
import { withPageTrailingSlash } from '../routing/page-href';
import { isSafeRelativePath } from '../routing/safe-relative-path';

export interface LocalizedReturnPathInput {
  /** Internal target, relative (`/app`, `/app/onboarding?role=stylist`). */
  path: string;
  /** `router.locale` of the page the login starts on. */
  locale: string | undefined;
  /** `router.defaultLocale` (Next literal); kernel default when absent. */
  defaultLocale?: string | undefined;
}

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

/**
 * Same-origin path of a front URL: a relative safe path passes as is, an
 * absolute URL on `origin` keeps its path + query + hash, anything else (other
 * origin, protocol-relative, garbage) collapses to the dashboard. Analytics
 * decorators may hand back either shape (first-touch returns a path, the e-mail
 * lifecycle tag returns an absolute URL), so every caller normalizes here.
 */
/** Origin of a URL, also for a non-special scheme (`capacitor://localhost`
 *  reports `origin === 'null'`). */
const originOf = (value: string): string => {
  const url = new URL(value);
  return url.origin !== 'null' ? url.origin : `${url.protocol}//${url.host}`;
};

export function toFrontendPath(pathOrUrl: string, origin: string): string {
  if (isSafeRelativePath(pathOrUrl)) {
    return pathOrUrl;
  }
  try {
    if (originOf(pathOrUrl) === originOf(origin)) {
      const url = new URL(pathOrUrl);
      return `${url.pathname}${url.search}${url.hash}`;
    }
  } catch {
    // Not an absolute URL either: fall through to the safe default.
  }
  return ROUTES_FRONT.APP;
}

/** Absolute URL on the front `origin` for a path (or same-origin URL). */
export function toFrontendUrl(pathOrUrl: string, origin: string): string {
  return `${originOf(origin)}${toFrontendPath(pathOrUrl, origin)}`;
}

export interface AuthRedirectTargetsInput {
  /** Validated INTERNAL target (`resolvePostLoginTarget` output), unprefixed. */
  target: string;
  /** `router.locale` of the login page. */
  locale: string | undefined;
  /** `router.defaultLocale`; kernel default when absent. */
  defaultLocale?: string | undefined;
  /** The front origin the login runs on (`window.location.origin`). */
  origin: string;
  /** Keep the sign-up framing on the error screen (`?intent=register`). */
  registerIntent?: boolean;
  /** Analytics decoration of the return path (first-touch, lifecycle tags). */
  decorate?: (path: string) => string;
}

export interface AuthRedirectTargets {
  /** Relative, localized return path: the native OAuth start takes ONLY this. */
  returnPath: string;
  /** Absolute success landing for Better Auth (`callbackURL`). */
  callbackURL: string;
  /** Absolute login screen for failures, carrying `?from=` back. */
  errorCallbackURL: string;
}

/**
 * ONE builder of the Better Auth redirect targets for every web sign-in channel
 * (magic link, Google). Both URLs are ABSOLUTE on the front origin.
 *
 * DECISION: absolute, never relative. Better Auth resolves a relative
 * `errorCallbackURL` against ITS OWN baseURL (api.example.com): the OAuth
 * state stores it verbatim and `redirectOnError` sends it as is, the magic-link
 * verify does `new URL(errorCallbackURL, baseURL)`. A failed sign-in (state
 * mismatch, used link) then landed on the API's 404 instead of the login screen
 * (owner report). Success hid the bug because the token bridge swaps
 * the origin only when a session was created. The backend repairs relative
 * targets too (better-auth `auth-redirect-targets.ts`) for cached bundles and old
 * e-mails; this builder is the primary contract. The error target carries `from`
 * so the retry after a failure still returns to the page she wanted.
 */
export function buildAuthRedirectTargets({
  target,
  locale,
  defaultLocale,
  origin,
  registerIntent = false,
  decorate,
}: AuthRedirectTargetsInput): AuthRedirectTargets {
  const safeTarget = isSafeRelativePath(target) ? target : ROUTES_FRONT.APP;
  const localized = resolveLocalizedReturnPath({
    path: safeTarget,
    locale,
    defaultLocale,
  });
  const returnPath = toFrontendPath(
    decorate ? decorate(localized) : localized,
    origin
  );
  const loginPath = resolveLocalizedReturnPath({
    path: ROUTES_FRONT.USER_LOG,
    locale,
    defaultLocale,
  });
  const errorQuery = new URLSearchParams({ from: safeTarget });
  if (registerIntent) {
    errorQuery.set('intent', 'register');
  }
  return {
    returnPath,
    callbackURL: toFrontendUrl(returnPath, origin),
    // The canonical slashed page URL: a slashless one costs a 301 (proxy.ts).
    errorCallbackURL: toFrontendUrl(
      `${withPageTrailingSlash(loginPath)}?${errorQuery}`,
      origin
    ),
  };
}
