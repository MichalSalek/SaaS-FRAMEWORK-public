/**
 * Unit tests for stripe-event-janitor.state.ts (BDX W0.2 — sweep-interceptor state).
 *
 * Why resetModules + dynamic import:
 *   `_lastJanitorRunTimestamp` is a module-level `let` initialised once at import time.
 *   Without `vi.resetModules()` the same module instance is shared across all tests
 *   in this file, so a `updateStripeEventJanitorTimestamp()` call in test N poisons
 *   test N+1 — order-dependent failures.  resetModules in beforeEach tears down the
 *   cached module registry, and `await import(...)` inside each test gets a fresh
 *   module with `_lastJanitorRunTimestamp = 0`.
 *
 * NOTE: this file covers the 60s throttle window (tighter than the 24h cleanup
 * interceptors — see DECISION D1 in the source file).
 *
 * S113: the sentence that used to stand here described W4.1 as future work — it has
 * shipped. `createSweepInterceptor` exists and eleven sweeps are built with it,
 * `recovery-expiry` among them. This janitor deliberately stays OUT of the factory
 * (see its interceptor header), which is exactly why this state module and this test
 * still exist. The `recovery-expiry.state.test.ts` the old text pointed at is gone
 * with the hand-rolled state it covered — do not go looking for it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const SIXTY_SECONDS_MS = 60 * 1000;

describe('stripe-event-janitor.state — throttle gate (60s window)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Tear down the module registry so each test gets _lastJanitorRunTimestamp = 0.
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows the first attempt (cold start, _lastJanitorRunTimestamp = 0)', async () => {
    vi.setSystemTime(new Date('2026-06-14T12:00:00.000Z'));

    const { shouldAttemptStripeEventJanitor } =
      await import('./stripe-event-janitor.state');

    expect(shouldAttemptStripeEventJanitor()).toBe(true);
  });

  it('blocks a second attempt within the 60s window after update', async () => {
    vi.setSystemTime(new Date('2026-06-14T12:00:00.000Z'));

    const {
      shouldAttemptStripeEventJanitor,
      updateStripeEventJanitorTimestamp,
    } = await import('./stripe-event-janitor.state');

    // First call — allowed (cold state).
    expect(shouldAttemptStripeEventJanitor()).toBe(true);

    // Mark janitor run done.
    updateStripeEventJanitorTimestamp();

    // Advance by 59 999 ms (1 ms before the window expires).
    vi.advanceTimersByTime(SIXTY_SECONDS_MS - 1);

    // Must still be blocked.
    expect(shouldAttemptStripeEventJanitor()).toBe(false);
  });

  it('allows a third attempt once the 60s window has fully elapsed', async () => {
    vi.setSystemTime(new Date('2026-06-14T12:00:00.000Z'));

    const {
      shouldAttemptStripeEventJanitor,
      updateStripeEventJanitorTimestamp,
    } = await import('./stripe-event-janitor.state');

    updateStripeEventJanitorTimestamp();

    // Advance past the full 60s window.
    vi.advanceTimersByTime(SIXTY_SECONDS_MS + 1);

    expect(shouldAttemptStripeEventJanitor()).toBe(true);
  });

  it('is order-independent: a fresh module always starts at _lastJanitorRunTimestamp = 0', async () => {
    // This test deliberately runs after the ones above and must still start cold.
    vi.setSystemTime(new Date('2026-06-14T00:00:00.000Z'));

    const {
      shouldAttemptStripeEventJanitor,
      updateStripeEventJanitorTimestamp,
    } = await import('./stripe-event-janitor.state');

    // Simulate a run and advance past the window.
    updateStripeEventJanitorTimestamp();
    vi.advanceTimersByTime(SIXTY_SECONDS_MS + 1);

    // Now allowed again — proves the test itself ran a full cycle from zero.
    expect(shouldAttemptStripeEventJanitor()).toBe(true);
  });
});
