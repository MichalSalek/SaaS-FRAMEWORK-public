// main/src/UI/hooks/useRafThrottledScroll.ts
// Shared rAF-throttled scroll listener.
//
// Coalesces high-frequency scroll events into one callback per animation frame,
// so layout reads (scrollTop / scrollY) and dataset writes do not thrash. The
// callback receives the current scroll offset (in px) of the target. Default
// target is `window`; pass an element ref's `.current` for nested scroll
// containers (e.g. AppLayout's main scroll element).
//
// Replaces three duplicated copies in AppLayout, PublicLayout, useShowOnScroll.

import { useEffect } from 'react';

type ScrollTarget = HTMLElement | Window;

function getScrollOffset(target: ScrollTarget): number {
  if (target === window) {
    return window.scrollY;
  }
  return (target as HTMLElement).scrollTop;
}

/**
 * Subscribe to scroll events on `target` and invoke `onScroll(scrollOffset)`
 * once per animation frame. Listener uses `{ passive: true }` to keep
 * compositor scrolling smooth.
 *
 * The hook also fires `onScroll` once on mount so callers see the initial
 * offset (handles restored scroll positions after back-navigation).
 *
 * @param onScroll Called with the current scroll offset in px.
 * @param target   Scroll container. Defaults to `window`. If you pass an
 *                 element reference that may be null on first render, do the
 *                 null-check yourself and pass `undefined` until ready.
 */
export function useRafThrottledScroll(
  onScroll: (scrollOffset: number) => void,
  target?: ScrollTarget | null
): void {
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    // `target === null` indicates a ref that hasn't mounted yet — bail out and
    // let the next render re-run the effect when the element is available.
    if (target === null) {
      return;
    }
    const scrollEl: ScrollTarget = target ?? window;

    let ticking = false;
    const handler = () => {
      if (ticking) {
        return;
      }
      ticking = true;
      requestAnimationFrame(() => {
        onScroll(getScrollOffset(scrollEl));
        ticking = false;
      });
    };

    // Initial sync — restored scroll positions after back-nav should reflect
    // the current offset without waiting for the next user scroll.
    handler();

    scrollEl.addEventListener('scroll', handler, { passive: true });
    return () => {
      scrollEl.removeEventListener('scroll', handler);
    };
  }, [onScroll, target]);
}
