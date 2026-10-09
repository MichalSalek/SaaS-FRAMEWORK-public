import { useCallback, useRef, useState } from 'react';
import { useRafThrottledScroll } from '../hooks/useRafThrottledScroll';

/**
 * Compact-on-scroll AppBar behavior (mirrors prototype). Returns a ref to attach
 * to the `<header>` and a callback-ref setter for the scroll container (`<main>`).
 *
 * The compact state is applied imperatively via `header.dataset.compact` rather
 * than React state — scroll fires at frame rate, so a per-frame re-render would
 * be wasteful. `useRafThrottledScroll` reads the target during `useEffect`, so we
 * track the scroll element through a callback-ref → setState pattern to re-trigger
 * the listener once `<main>` mounts.
 */
export function useScrollCompactHeader() {
  const headerRef = useRef<HTMLElement>(null);
  const lastScrollYRef = useRef(0);
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);

  const handleScroll = useCallback((currentY: number) => {
    const delta = currentY - lastScrollYRef.current;
    const header = headerRef.current;
    if (header) {
      if (delta > 0 && currentY > 50) {
        header.dataset['compact'] = '';
      } else if (delta < 0 && Math.abs(delta) > 3) {
        delete header.dataset['compact'];
      }
    }
    lastScrollYRef.current = currentY;
  }, []);

  useRafThrottledScroll(handleScroll, scrollEl);

  return { headerRef, setScrollEl };
}
