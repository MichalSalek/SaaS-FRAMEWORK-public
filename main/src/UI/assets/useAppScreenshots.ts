import { useCallback } from 'react';
import { useLocale } from 'next-intl';
import { LP_ASSETS } from './lpAssets';

export type AppScreenshotKey = keyof typeof LP_ASSETS.app;

type ScreenshotLocale = keyof (typeof LP_ASSETS.app)['appDashboard'];

const FALLBACK_LOCALE: ScreenshotLocale = 'pl';

function isSupported(locale: string): locale is ScreenshotLocale {
  return locale in LP_ASSETS.app.appDashboard;
}

/**
 * Ścieżka do zrzutu aplikacji w danym języku.
 *
 * DECISION: app screenshots are trilingual because app screens contain text: one shot for every
 * locale gives the mockup away (a German page with a Polish phone) (owner). The path is
 * chosen HERE, not in components, otherwise each of ~30 call sites would build it its own way, and
 * `audit:asset-paths` verifies file existence only for literals in `lpAssets.ts`. An unknown locale
 * falls back to Polish rather than an empty path: an empty phone frame looks like a failure, not a
 * missing translation.
 */
function resolveAppScreenshot(key: AppScreenshotKey, locale: string): string {
  const screens = LP_ASSETS.app[key];
  return screens[isSupported(locale) ? locale : FALLBACK_LOCALE];
}

/** Jeden hak na komponent, dowolnie wiele ekranów w tym komponencie. */
export function useAppScreenshots(): (key: AppScreenshotKey) => string {
  const locale = useLocale();
  return useCallback(
    (key: AppScreenshotKey) => resolveAppScreenshot(key, locale),
    [locale]
  );
}
