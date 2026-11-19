import { useLayoutEffect, type RefObject } from 'react';
import { useRouter } from 'next/router';
import {
  useReportAppHeroPresence,
  useReportAppHeroVisibility,
} from './appHeroVisibility';

export function useReportHeroVisibility(
  ref: RefObject<HTMLElement | null>,
  enabled = true
): void {
  const reportVisible = useReportAppHeroVisibility();
  const reportPresent = useReportAppHeroPresence();
  // asPath is a dependency: same-route navigation (a query/param change without remounting the
  // page) resets suppression in AppLayout, and without re-running this effect the hero would never
  // report again (an IntersectionObserver does not fire without crossing a threshold), leaving the
  // top-bar title over a visible hero until the first scroll.
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

    const main = el.closest('#main-content');
    const scrollRoot =
      main !== null && /(auto|scroll)/.test(getComputedStyle(main).overflowY)
        ? main
        : null;
    // One SYNCHRONOUS measurement BEFORE the IntersectionObserver is attached. The observer
    // reports asynchronously, only AFTER the first paint, and AppLayout mounts per page with
    // suppressed=false, so on every navigation the top-bar title flashed for ~100-300ms before the
    // observer reported isIntersecting:true. useLayoutEffect plus a manual getBoundingClientRect
    // closes the first report before paint; the observer handles later updates (scroll, resize,
    // reveal).
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
