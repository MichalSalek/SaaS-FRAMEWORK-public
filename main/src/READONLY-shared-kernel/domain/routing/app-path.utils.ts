import { I18N_CONFIG } from '../i18n/i18n.config';
import { ROUTES_FRONT_APP } from './routing.config';

/**
 * Locale-prefix helpers for FRONT paths (Next.js Pages Router i18n: the default
 * locale is served UNPREFIXED, every other locale under `/<locale>/…`).
 *
 * DECISION: the post-login return path carries a locale prefix (`/en/app`, `/de/app`), so EVERY "is
 * this an app path" allowlist must understand it: backend `native-oauth-start` (callbackURL), the
 * front deep-link listener (`native-deeplink-listener.ts`) and the native wrapper (its own copy in
 * `native-wrapper/src/lib/deeplink.ts`, it cannot import the kernel). One definition here, so
 * `/en/app` is never outside /app in one place and inside in another. Segment-aware: `/apple` is not
 * an app path.
 */

const LOCALE_SEGMENT_RE = new RegExp(
  `^/(${I18N_CONFIG.locales.join('|')})(?=/|$)`
);

/** Strips a leading known-locale segment: `/en/app?x` → `/app?x`, `/app` → `/app`. */
export const stripLocalePrefix = (path: string): string =>
  path.replace(LOCALE_SEGMENT_RE, '') || '/';

/** Leading known-locale segment of a path, or null when unprefixed (default locale). */
export const readLocalePrefix = (
  path: string
): (typeof I18N_CONFIG.locales)[number] | null => {
  const match = LOCALE_SEGMENT_RE.exec(path);
  const segment = match?.[1];
  return (I18N_CONFIG.locales as readonly string[]).includes(segment ?? '')
    ? (segment as (typeof I18N_CONFIG.locales)[number])
    : null;
};

/** `/app` or under `/app/`, with or without a leading locale segment. */
export const isAppZonePath = (pathname: string): boolean => {
  const bare = stripLocalePrefix(pathname);
  return (
    bare === ROUTES_FRONT_APP.APP || bare.startsWith(`${ROUTES_FRONT_APP.APP}/`)
  );
};
