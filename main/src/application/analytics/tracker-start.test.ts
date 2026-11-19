import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  haveTrackersStarted,
  onTrackersMayStart,
  resetTrackerStartForTests,
} from './tracker-start';
import { TRACKER_START } from './tracker-start.helpers';

describe('tracker start gate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom has no requestIdleCallback: the gate falls back to a timer.
    window.history.replaceState(null, '', '/pricing/');
  });

  afterEach(() => {
    resetTrackerStartForTests();
    vi.useRealTimers();
    window.history.replaceState(null, '', '/');
  });

  it('opens on the first interaction', () => {
    const listener = vi.fn();
    onTrackersMayStart(listener);
    expect(listener).not.toHaveBeenCalled();

    window.dispatchEvent(new Event('pointerdown'));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(haveTrackersStarted()).toBe(true);
    window.dispatchEvent(new Event('pointerdown'));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('opens on its own after load and the quiet time', () => {
    const listener = vi.fn();
    onTrackersMayStart(listener);

    vi.advanceTimersByTime(TRACKER_START.QUIET_AFTER_LOAD_MS - 1);
    expect(listener).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('skips the quiet time when the address carries the source', () => {
    window.history.replaceState(null, '', '/?utm_source=chatgpt.com');
    const listener = vi.fn();
    onTrackersMayStart(listener);

    vi.advanceTimersByTime(5);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not hold back a screen that is not a public page', () => {
    window.history.replaceState(null, '', '/user/login/');
    const listener = vi.fn();
    onTrackersMayStart(listener);

    vi.advanceTimersByTime(5);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('runs a late subscriber at once and lets an early one leave', () => {
    const leaving = vi.fn();
    const unsubscribe = onTrackersMayStart(leaving);
    unsubscribe();
    window.dispatchEvent(new Event('keydown'));
    expect(leaving).not.toHaveBeenCalled();

    const late = vi.fn();
    onTrackersMayStart(late);
    expect(late).toHaveBeenCalledTimes(1);
  });
});
