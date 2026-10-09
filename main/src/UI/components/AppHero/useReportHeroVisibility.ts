import { useLayoutEffect, type RefObject } from 'react';
import { useRouter } from 'next/router';
import {
  useReportAppHeroPresence,
  useReportAppHeroVisibility,
} from './appHeroVisibility';

/**
 * Wspólne jądro mechanizmu „iOS large-title": podpina element karty-intro pod
 * kanał widoczności AppHero. Obserwuje wejście/wyjście elementu z pola widzenia
 * scroll-roota (`#main-content`) i raportuje to do AppLayout, który wygasza tytuł
 * w top-barze, gdy karta jest widoczna, i wjeżdża z nim po jej przescrollowaniu.
 *
 * Używane przez <AppHeroOrganism>, onboardingowy hero i nagłówek strony admina
 * (ten sam mechanizm — nie duplikujemy obserwatora). Poza AppLayout raportowanie jest
 * no-op (brak providera), więc hook jest bezpieczny na każdym ekranie.
 *
 * Scroll-root = layoutowy `<main id="main-content">` — w trybie frame (desktop)
 * scroll dzieje się WEWNĄTRZ ramki telefonu, więc `root: null` (viewport) byłby
 * błędny; `closest('#main-content')` znajduje właściwy kontener. Wyjątek: shell
 * admina, gdzie przewija się dokument (patrz komentarz w efekcie).
 *
 * `enabled=false` gdy karta znika z drzewa warunkowo (np. onboarding wchodzi na
 * terminalny widok success bez zmiany trasy): usunięcie obserwowanego węzła z DOM
 * NIE emituje callbacku `isIntersecting:false`, więc bez jawnego raportu top-bar
 * zostałby wygaszony na zawsze. Wtedy rozłączamy obserwator i raportujemy false.
 */
export function useReportHeroVisibility(
  ref: RefObject<HTMLElement | null>,
  enabled = true
): void {
  const reportVisible = useReportAppHeroVisibility();
  const reportPresent = useReportAppHeroPresence();
  // asPath w deps: nawigacja same-route (zmiana query/param bez remountu strony)
  // resetuje suppression w AppLayout, ale bez re-runu tego efektu hero nigdy nie
  // zaraportowałby się ponownie (IO nie strzela bez przecięcia progu) → tytuł
  // top-bara wisiałby nad widocznym hero do pierwszego scrolla (review S50b #4).
  const { asPath } = useRouter();
  useLayoutEffect(() => {
    if (!enabled) {
      reportVisible(false);
      reportPresent(false);
      return;
    }
    const el = ref.current;
    if (el == null) {
      return;
    }
    reportPresent(true);
    // `#main-content` is the scroller in AppLayout and the desktop account
    // layout; in the admin shell the DOCUMENT scrolls and `<main>` only grows,
    // so observing against it would report "visible" forever. A root that
    // does not scroll falls back to the viewport.
    const main = el.closest('#main-content');
    const scrollRoot =
      main !== null && /(auto|scroll)/.test(getComputedStyle(main).overflowY)
        ? main
        : null;
    // Jednorazowy SYNCHRONICZNY pomiar PRZED podpięciem IntersectionObservera.
    // IO raportuje asynchronicznie, dopiero PO pierwszym paincie — a AppLayout
    // montuje się per-page ze stanem suppressed=false, więc przy każdej nawigacji
    // tytuł w top-barze błyskał na ~100-300ms, zanim IO zdążył zgłosić
    // isIntersecting:true. useLayoutEffect + ręczny getBoundingClientRect domykają
    // pierwszy raport jeszcze przed malowaniem; IO zostaje do bieżących update'ów
    // (scroll, resize, odsłanianie).
    const rootRect = scrollRoot?.getBoundingClientRect() ?? {
      top: 0,
      bottom: window.innerHeight,
    };
    const rect = el.getBoundingClientRect();
    reportVisible(rect.bottom > rootRect.top && rect.top < rootRect.bottom);
    const io = new IntersectionObserver(
      entries => {
        const entry = entries[0];
        if (entry != null) {
          reportVisible(entry.isIntersecting);
        }
      },
      { root: scrollRoot, threshold: 0 }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      reportVisible(false);
      reportPresent(false);
    };
  }, [ref, reportVisible, reportPresent, enabled, asPath]);
}
