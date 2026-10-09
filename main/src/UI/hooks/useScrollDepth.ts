import { useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import {
  trackScrollDepth,
  type ScrollDepth,
} from '../../application/analytics/cta-events';

const THRESHOLDS: readonly ScrollDepth[] = [25, 50, 75, 100];

/**
 * Progi przewinięcia strony: 25 / 50 / 75 / 100 procent, każdy raz na stronę.
 *
 * GA4 ma wbudowany pomiar przewinięcia, ale strzela raz, na 90 procentach — z
 * czego wynika tylko „doczytał albo nie". Rozbicie na cztery progi odróżnia
 * stronę, którą ktoś porzucił w połowie, od takiej, której nie przewinął wcale,
 * a to dwa różne problemy z dwoma różnymi lekarstwami.
 *
 * Licznik zeruje się przy zmianie ścieżki, bo nawigacja klientem nie przeładowuje
 * komponentu — bez tego kolejna strona w tej samej sesji nie zaraportowałaby nic.
 */
export function useScrollDepth(): void {
  // KONKRETNA ścieżka, bez query i bez hasha.
  //
  // `router.pathname` to wzorzec trasy (`/blog/[slug]`), więc przejście między
  // dwoma wpisami bloga go NIE zmienia — progi z pierwszego artykułu wyciszałyby
  // pomiar w każdym następnym. `asPath` zmienia się za to także przy kliknięciu
  // w kotwicę (#pricing-faq), co pozwoliłoby policzyć te same progi dwa razy na
  // tym samym ekranie. Prawdziwą tożsamością strony jest asPath obcięty na `?` i `#`.
  const { asPath } = useRouter();
  const pagePath = asPath.split(/[?#]/)[0];
  const firedRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    firedRef.current = new Set();
  }, [pagePath]);

  useEffect(() => {
    let ticking = false;
    let frameId = 0;

    const onScroll = () => {
      if (ticking) {
        return;
      }
      ticking = true;
      frameId = requestAnimationFrame(() => {
        ticking = false;
        // Odczyt scrollHeight wymusza reflow — stąd throttling do jednej klatki.
        const scrollable =
          document.documentElement.scrollHeight - window.innerHeight;
        if (scrollable <= 0) {
          return;
        }
        const percent = Math.round((window.scrollY / scrollable) * 100);

        for (const threshold of THRESHOLDS) {
          if (percent >= threshold && !firedRef.current.has(threshold)) {
            firedRef.current.add(threshold);
            trackScrollDepth(threshold);
          }
        }
      });
    };

    // Pomiar początkowy: po nawigacji przeglądarka potrafi przywrócić pozycję
    // scrolla, a bez tego wywołania progi osiągnięte „od razu" nie odpaliłyby aż
    // do kolejnego ruchu — i przepadłyby, gdyby użytkowniczka od razu wyszła.
    onScroll();

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      // Zaplanowana klatka przeżyłaby nawigację i policzyła próg dla układu
      // poprzedniej strony.
      cancelAnimationFrame(frameId);
    };
  }, [pagePath]);
}
