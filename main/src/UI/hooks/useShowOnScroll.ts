import { useCallback, useState } from 'react';
import { useRafThrottledScroll } from './useRafThrottledScroll';
import { useScrollIntent } from './useScrollIntent';

/**
 * Returns `true` once the user has scrolled past `threshold` pixels; on a
 * phone also only while she is scrolling UP (see below).
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

  // On a phone the floating button moves with the menu bar. It leaves the
  // screen while she scrolls down and returns only on a clear upward move
  // (owner; thresholds in shared/scroll/scroll-intent.ts).
  const { intent, isNarrow } = useScrollIntent();

  return show && (!isNarrow || intent === 'up');
}
