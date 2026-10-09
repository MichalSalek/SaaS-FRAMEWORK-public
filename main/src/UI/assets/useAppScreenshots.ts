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
 * DECISION (nie usuwaj tego komentarza) — owner 2026-09-17:
 * Na ekranach aplikacji jest tekst, więc jeden zrzut na wszystkie wersje
 * językowe od razu zdradza atrapę: niemiecka strona z polskim telefonem.
 * Zrzuty są trójjęzyczne, a wybór ścieżki siedzi TUTAJ, a nie w komponentach —
 * inaczej każdy z trzydziestu punktów użycia sklejałby ją po swojemu, a
 * strażnik `audit:asset-paths` sprawdza istnienie plików wyłącznie dla
 * literałów z `lpAssets.ts`. Nieznany język schodzi do polskiego zamiast oddać
 * pustą ścieżkę: pusta ramka telefonu wygląda jak awaria, nie jak brak
 * tłumaczenia.
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
