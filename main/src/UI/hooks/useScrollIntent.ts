// UI/hooks/useScrollIntent.ts
// One window-scroll reader for the public layout: is the page past its top,
// and which way does the visitor mean to scroll (rules and the owner's words
// in shared/scroll/scroll-intent.ts). A module-level store, so the header and
// the floating CTA read the SAME state and move together.

import { useSyncExternalStore } from 'react';
import {
  INITIAL_SCROLL_INTENT,
  nextScrollIntent,
  pendingRecheckDelay,
  SCROLL_INTENT,
  type ScrollIntent,
  type ScrollIntentState,
} from '../shared/scroll/scroll-intent';

export interface ScrollIntentSnapshot {
  intent: ScrollIntent;
  isPastTop: boolean;
  /** Below 768px: the widths where the intent drives the header and the CTA. */
  isNarrow: boolean;
}

const NARROW_QUERY = '(max-width: 767.98px)';
const SERVER_SNAPSHOT: ScrollIntentSnapshot = {
  intent: 'up',
  isPastTop: false,
  isNarrow: false,
};

let state: ScrollIntentState = INITIAL_SCROLL_INTENT;
let snapshot: ScrollIntentSnapshot = SERVER_SNAPSHOT;
const listeners = new Set<() => void>();
let frame = 0;
let recheck: ReturnType<typeof setTimeout> | undefined;
let narrowQuery: MediaQueryList | undefined;

function publish(): void {
  const next: ScrollIntentSnapshot = {
    intent: state.intent,
    isPastTop: state.lastY > SCROLL_INTENT.TOP_PX,
    isNarrow: narrowQuery?.matches ?? false,
  };
  if (
    next.intent === snapshot.intent &&
    next.isPastTop === snapshot.isPastTop &&
    next.isNarrow === snapshot.isNarrow
  ) {
    return;
  }
  snapshot = next;
  listeners.forEach(listener => listener());
}

function sample(): void {
  frame = 0;
  const now = performance.now();
  state = nextScrollIntent(state, window.scrollY, now);
  publish();
  // A flick that went far enough and then stopped: no further scroll event
  // will come, so the time threshold is checked once more on a timer.
  if (recheck !== undefined) {
    clearTimeout(recheck);
    recheck = undefined;
  }
  const delay = pendingRecheckDelay(state, now);
  if (delay !== null) {
    recheck = setTimeout(sample, delay + 1);
  }
}

function onScroll(): void {
  if (frame === 0) {
    frame = requestAnimationFrame(sample);
  }
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    narrowQuery = window.matchMedia(NARROW_QUERY);
    narrowQuery.addEventListener('change', publish);
    window.addEventListener('scroll', onScroll, { passive: true });
    // The first sample covers a scroll position restored by the browser. It
    // waits for the next frame: read synchronously here, `scrollY` forced a
    // layout in the middle of the hydration commit.
    onScroll();
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) {
      return;
    }
    window.removeEventListener('scroll', onScroll);
    narrowQuery?.removeEventListener('change', publish);
    if (frame !== 0) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    if (recheck !== undefined) {
      clearTimeout(recheck);
      recheck = undefined;
    }
  };
}

export function useScrollIntent(): ScrollIntentSnapshot {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => SERVER_SNAPSHOT
  );
}
