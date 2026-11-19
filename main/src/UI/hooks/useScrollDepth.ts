import { useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import {
  trackScrollDepth,
  type ScrollDepth,
} from '../../application/analytics/cta-events';

const THRESHOLDS: readonly ScrollDepth[] = [25, 50, 75, 100];

/**
 * Scroll-depth thresholds: 25 / 50 / 75 / 100 percent, each once per page.
 *
 * GA4 has a built-in scroll measure, and it fires once, at 90 percent, which
 * only says whether someone finished the page. Four thresholds separate a
 * page abandoned halfway from a page that was never scrolled. Those are two
 * different problems with two different fixes.
 *
 * The counter resets when the path changes. Client navigation does not remount
 * this component, so without the reset the next page in the same session
 * would report nothing.
 */
export function useScrollDepth(): void {
  // The concrete path, with no query and no hash.
  //
  // `router.pathname` is the route pattern (`/blog/[slug]`), so moving between
  // two blog posts does not change it and the first article's thresholds would
  // silence every later one. `asPath` also changes on an in-page anchor
  // (#pricing-faq), which would count the same thresholds twice on one screen.
  // The page identity is asPath cut at `?` and `#`.
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

    // Initial measure. After navigation the browser can restore the scroll
    // position, and without this call thresholds already reached would wait
    // for the next movement and be lost if she left immediately.
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
