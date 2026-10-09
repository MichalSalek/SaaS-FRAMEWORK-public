import { I18N_CONFIG } from '../i18n/i18n.config';
import { ROUTES_FRONT_APP } from './routing.config';

/**
 * Locale-prefix helpers for FRONT paths (Next.js Pages Router i18n: the default
 * locale is served UNPREFIXED, every other locale under `/<locale>/…`).
 *
 * DECISION (nie usuwaj tego komentarza) — D6 (2026-09-05):
 * Ścieżka powrotu po logowaniu niesie prefiks języka (`/en/app`, `/de/app`),
 * więc KAŻDA allowlista „czy to ścieżka aplikacji" musi go rozumieć: backendowy
 * `native-oauth-start` (callbackURL), frontowy odbiornik deep-linku
 * (`native-deeplink-listener.ts`) i wrapper natywny (własna kopia tej reguły w
 * `native-wrapper/src/lib/deeplink.ts`, bo nie importuje kernela). Jedna
 * definicja tutaj, żeby `/en/app` nie było „poza /app" w jednym miejscu, a
 * „w /app" w drugim. Segment-aware: `/apple` NIE jest ścieżką aplikacji.
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
