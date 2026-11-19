import { describe, expect, it } from 'vitest';
import {
  INITIAL_SCROLL_INTENT,
  nextScrollIntent,
  pendingRecheckDelay,
  SCROLL_INTENT,
  type ScrollIntentState,
} from './scroll-intent';

/** Feeds `[y, ms]` samples and returns the final state. */
function run(
  samples: ReadonlyArray<readonly [number, number]>,
  from: ScrollIntentState = INITIAL_SCROLL_INTENT
): ScrollIntentState {
  return samples.reduce(
    (state, [y, now]) => nextScrollIntent(state, y, now),
    from
  );
}

describe('nextScrollIntent', () => {
  it('is „up” at the top of the page whatever happened before', () => {
    const down = run([
      [200, 0],
      [600, 100],
    ]);
    expect(down.intent).toBe('down');
    expect(run([[SCROLL_INTENT.TOP_PX, 200]], down).intent).toBe('up');
  });

  it('hides at once on a real move down and ignores jitter', () => {
    expect(
      run([
        [100, 0],
        [108, 16],
      ]).intent
    ).toBe('up');
    expect(
      run([
        [100, 0],
        [120, 16],
      ]).intent
    ).toBe('down');
  });

  it('a jerk „down, up, down” does not show the bar again', () => {
    const state = run([
      [300, 0],
      [900, 200],
      // A fast flick up, far enough but too short…
      [830, 230],
      // …and down again.
      [880, 260],
      [960, 320],
    ]);
    expect(state.intent).toBe('down');
  });

  it('a short nudge up is not an intent, however long it lasts', () => {
    const state = run([
      [300, 0],
      [900, 200],
      [880, 400],
      [870, 900],
    ]);
    expect(state.intent).toBe('down');
  });

  it('a deliberate scroll up shows the bar: far enough AND long enough', () => {
    const state = run([
      [300, 0],
      [900, 200],
      [880, 220],
      [850, 280],
      [830, 380],
    ]);
    expect(state.intent).toBe('up');
  });

  it('after the jerk the distance is counted from the new lowest point', () => {
    const state = run([
      [300, 0],
      [900, 200],
      [860, 230],
      [1000, 300],
      // 50px up from 1000: under the threshold although far above 900 - 56.
      [950, 600],
    ]);
    expect(state.intent).toBe('down');
  });
});

describe('pendingRecheckDelay', () => {
  it('asks for one more sample when the flick stopped before the time passed', () => {
    const state = run([
      [300, 0],
      [900, 200],
      [820, 230],
    ]);
    expect(state.intent).toBe('down');
    const delay = pendingRecheckDelay(state, 240);
    expect(delay).toBe(SCROLL_INTENT.UP_MS - 10);
    // The same offset sampled again after the delay flips the intent.
    expect(
      nextScrollIntent(state, state.lastY, 230 + SCROLL_INTENT.UP_MS).intent
    ).toBe('up');
  });

  it('asks for nothing when the move up was too short', () => {
    const state = run([
      [300, 0],
      [900, 200],
      [880, 230],
    ]);
    expect(pendingRecheckDelay(state, 240)).toBeNull();
  });
});
