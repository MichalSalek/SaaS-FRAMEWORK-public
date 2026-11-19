// UI/shared/scroll/scroll-intent.ts
// Which way the visitor MEANS to scroll, judged from scroll samples.
//
// DECISION: on public pages on a phone the header shrinks and the floating CTA
// hides on scroll down, and both return on a DELIBERATE scroll up. A finger
// jerk (down, up, down) must not trigger animations, yet the return must not
// lag: two upward thresholds (distance AND time) and one small downward one,
// so hiding is immediate and showing is considered. At the very top the state
// is always 'up' (full header). (owner)

export type ScrollIntent = 'up' | 'down';

export interface ScrollIntentState {
  intent: ScrollIntent;
  /** The extreme since the last flip: the highest point while `up`, the
   *  lowest while `down`. A reversal is measured from it. */
  pivotY: number;
  /** When the current upward movement began (ms); `null` when there is none. */
  reverseSince: number | null;
  lastY: number;
}

export const SCROLL_INTENT = {
  /** At or above this offset the page counts as „at the top”. */
  TOP_PX: 50,
  /** Downward travel that hides: small, only to ignore jitter. */
  DOWN_PX: 16,
  /** Upward travel that shows again… */
  UP_PX: 56,
  /** …once the upward movement has lasted this long. */
  UP_MS: 140,
} as const;

/** Before the first sample: the pivot is „nowhere yet”, so a page opened in
 *  its middle (a restored scroll position) starts expanded and counts the
 *  first move down from where it stands. */
export const INITIAL_SCROLL_INTENT: ScrollIntentState = {
  intent: 'up',
  pivotY: Number.POSITIVE_INFINITY,
  reverseSince: null,
  lastY: 0,
};

/** The state after one scroll sample at offset `y`, taken at `now` (ms). */
export function nextScrollIntent(
  state: ScrollIntentState,
  y: number,
  now: number
): ScrollIntentState {
  if (y <= SCROLL_INTENT.TOP_PX) {
    return { intent: 'up', pivotY: y, reverseSince: null, lastY: y };
  }

  if (state.intent === 'up') {
    const pivotY = Math.min(state.pivotY, y);
    if (y - pivotY >= SCROLL_INTENT.DOWN_PX) {
      return { intent: 'down', pivotY: y, reverseSince: null, lastY: y };
    }
    return { intent: 'up', pivotY, reverseSince: null, lastY: y };
  }

  // Going down, or lower than ever since the flip: a new lowest point.
  if (y >= state.pivotY || y > state.lastY) {
    return { intent: 'down', pivotY: y, reverseSince: null, lastY: y };
  }

  // Above the lowest point and not moving down: an upward movement.
  const reverseSince = state.reverseSince ?? now;
  const hasTravelled = state.pivotY - y >= SCROLL_INTENT.UP_PX;
  const hasLasted = now - reverseSince >= SCROLL_INTENT.UP_MS;
  if (hasTravelled && hasLasted) {
    return { intent: 'up', pivotY: y, reverseSince: null, lastY: y };
  }
  return { intent: 'down', pivotY: state.pivotY, reverseSince, lastY: y };
}

/**
 * Milliseconds after which the state should be sampled again WITHOUT a new
 * scroll event: the visitor flicked far enough up and then stopped before the
 * time threshold passed. `null` when nothing is pending.
 */
export function pendingRecheckDelay(
  state: ScrollIntentState,
  now: number
): number | null {
  if (state.intent !== 'down' || state.reverseSince === null) {
    return null;
  }
  if (state.pivotY - state.lastY < SCROLL_INTENT.UP_PX) {
    return null;
  }
  return Math.max(0, state.reverseSince + SCROLL_INTENT.UP_MS - now);
}
