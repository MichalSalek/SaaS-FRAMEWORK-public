import { useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import type { AppHeroVisibilityContextValue } from '../components/AppHero/appHeroVisibility';

/**
 * AppHero-aware AppBar title (głos ownera S27/2 = B).
 * Gdy widoczna jest karta-intro (AppHero) niosąca ten sam tytuł, top-bar go
 * wygasza; po przescrollowaniu karty tytuł wjeżdża (iOS large-title). AppHero
 * raportuje swoją widoczność przez kontekst; strony bez AppHero nigdy nie
 * ustawiają suppressed=true, więc tytuł działa jak dotąd.
 *
 * Zwraca `heroTitleSuppressed` (flaga na `<header data-hero-title-hidden>`),
 * `heroPresent` (czy ekran ma kartę-intro z własnym `<h1>`) oraz
 * `heroVisibilityValue` (provider value dla `AppHeroVisibilityContext`).
 */
export function useHeroTitleSuppression() {
  const router = useRouter();
  const [heroTitleSuppressed, setHeroTitleSuppressed] = useState(false);
  // A hero carries the screen's <h1>. Where none is mounted, the top-bar title
  // is the heading (S126: screens without an intro card had no <h1> at all).
  const [heroPresent, setHeroPresent] = useState(false);
  const heroVisibilityValue = useMemo<AppHeroVisibilityContextValue>(
    () => ({
      reportVisible: setHeroTitleSuppressed,
      reportPresent: setHeroPresent,
    }),
    []
  );
  // Reset na zmianę trasy: nowa strona domyślnie pokazuje tytuł, dopóki jej
  // AppHero (jeśli jest) nie zaraportuje widoczności — zapobiega utknięciu
  // w stanie suppressed po nawigacji na ekran bez karty-intro.
  //
  // Wzorzec „adjust state during render" (NIE pasywny useEffect): efekt odpalał
  // się dopiero PO paincie i CLOBBEROWAŁ synchroniczny raport dziecka —
  // useReportHeroVisibility (useLayoutEffect w AppHero) zdążył już zgłosić
  // suppressed=true przed malowaniem, a spóźniony reset z efektu przywracał
  // false → flash tytułu przy każdej nawigacji na stronę z hero.
  const [prevPath, setPrevPath] = useState(router.asPath);
  if (prevPath !== router.asPath) {
    setPrevPath(router.asPath);
    setHeroTitleSuppressed(false);
    setHeroPresent(false);
  }

  return { heroTitleSuppressed, heroPresent, heroVisibilityValue };
}
