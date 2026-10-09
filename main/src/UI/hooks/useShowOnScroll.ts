import { useCallback, useState } from 'react';
import { useRafThrottledScroll } from './useRafThrottledScroll';

/**
 * Returns `true` once the user has scrolled past `threshold` pixels.
 * Used to trigger scroll-aware UI elements (e.g. StickyCtaBar).
 *
 * Passive scroll listener — zero layout thrashing. Listener is rAF-throttled
 * via the shared `useRafThrottledScroll` hook.
 */
export function useShowOnScroll(threshold = 400): boolean {
  const [show, setShow] = useState(false);

  const onScroll = useCallback(
    (scrollY: number) => {
      setShow(scrollY > threshold);
    },
    [threshold]
  );

  useRafThrottledScroll(onScroll);

  return show;
}
