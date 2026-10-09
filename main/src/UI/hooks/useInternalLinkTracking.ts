import { useEffect } from 'react';
import { trackInternalLinkClick } from '../../application/analytics/cta-events';

/**
 * Kliknięcia w linki wewnętrzne W TREŚCI strony.
 *
 * PostHog i GA4 rysują ścieżki z odsłon, ale odsłona nie mówi, CZYM ktoś poszedł
 * dalej: linkiem w akapicie, kaflem „zobacz też" czy pozycją w menu. Dopiero to
 * zamienia ciąg adresów w mapę, po której widać, które przejścia faktycznie
 * działają, a które są tylko obecne.
 *
 * Jeden nasłuch na dokumencie zamiast `onClick` na każdym linku: linków w treści
 * są setki i mieszkają w MDX, nie w JSX.
 *
 * Świadomie POMIJAMY nagłówek, stopkę, menu i pasek dolny (chrome jest ten sam
 * na każdej stronie, jego krawędzie nic nie mówią o treści) oraz elementy z
 * własnym pomiarem CTA, żeby jedno kliknięcie nie liczyło się dwa razy.
 */
export function useInternalLinkTracking(): void {
  useEffect(() => {
    function onClick(event: MouseEvent) {
      // Tylko lewy przycisk i aktywacja klawiaturą (Enter emituje `click`).
      // Środkowy idzie przez `auxclick`, więc tu nie dociera — na linkach w
      // treści to margines, którego nie warto osobno obsługiwać.
      if (event.button !== 0) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const anchor = target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }

      if (
        anchor.closest(
          '[data-cta-tracked], [data-sticky-cta], header, footer, nav'
        )
      ) {
        return;
      }

      const href = anchor.getAttribute('href') ?? '';
      if (!href.startsWith('/') || href.startsWith('//')) {
        return;
      }

      trackInternalLinkClick(href);
    }

    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);
}
