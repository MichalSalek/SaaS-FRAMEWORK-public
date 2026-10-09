/**
 * Unit tests for create-sweep-interceptor.ts (BDX W4.1 — sweep-interceptor factory).
 *
 * Replaces recovery-expiry.state.test.ts (the per-sweep throttle `let` it tested no
 * longer exists — the throttle is now a closure-private `let lastRunAt` owned by the
 * factory). The stripe-event-janitor.state.test.ts STAYS (cross-instance janitor is
 * the documented exception that does NOT use this factory).
 *
 * Why fake timers + resetModules:
 *   The throttle window is `Date.now() - lastRunAt`. vi.useFakeTimers() lets us pin
 *   the clock and advance it deterministically across the window boundary. Each
 *   createSweepInterceptor() call returns a closure with its OWN `lastRunAt = 0`, so
 *   per-interceptor isolation is structural; resetModules() additionally guarantees
 *   the mocked deps start fresh each test.
 *
 * recordSweepRun + reportIssueBackend are mocked so the factory's throttle/timing/
 * NEVER-throw skeleton is tested in isolation (no sweep-monitoring / event-log side
 * effects).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

vi.mock('@app/health/sweep-monitoring.utils', () => ({
  recordSweepRun: vi.fn(),
}));
vi.mock('@app/debugger/error-handler', () => ({
  reportIssueBackend: vi.fn(),
}));

const importFactory = async () => {
  const mod = await import('./create-sweep-interceptor');
  const monitoring = await import('@app/health/sweep-monitoring.utils');
  const debugger_ = await import('@app/debugger/error-handler');
  return {
    createSweepInterceptor: mod.createSweepInterceptor,
    recordSweepRun: vi.mocked(monitoring.recordSweepRun),
    reportIssueBackend: vi.mocked(debugger_.reportIssueBackend),
  };
};

describe('createSweepInterceptor — throttle gate + NEVER-throw skeleton', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs on the first invocation (cold start, lastRunAt = 0)', async () => {
    vi.setSystemTime(new Date('2026-06-14T12:00:00.000Z'));
    const { createSweepInterceptor } = await importFactory();

    const run = vi.fn().mockResolvedValue(undefined);
    const interceptor = createSweepInterceptor({
      name: 'event-log-cleanup',
      throttleMs: TWENTY_FOUR_HOURS_MS,
      run,
    });

    await interceptor();

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('blocks a second invocation within the throttle window', async () => {
    vi.setSystemTime(new Date('2026-06-14T12:00:00.000Z'));
    const { createSweepInterceptor } = await importFactory();

    const run = vi.fn().mockResolvedValue(undefined);
    const interceptor = createSweepInterceptor({
      name: 'event-log-cleanup',
      throttleMs: TWENTY_FOUR_HOURS_MS,
      run,
    });

    await interceptor(); // runs (cold)
    vi.advanceTimersByTime(TWENTY_FOUR_HOURS_MS - 1); // 1ms before window expires
    await interceptor(); // blocked

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs again once the throttle window has fully elapsed', async () => {
    vi.setSystemTime(new Date('2026-06-14T12:00:00.000Z'));
    const { createSweepInterceptor } = await importFactory();

    const run = vi.fn().mockResolvedValue(undefined);
    const interceptor = createSweepInterceptor({
      name: 'event-log-cleanup',
      throttleMs: TWENTY_FOUR_HOURS_MS,
      run,
    });

    await interceptor(); // runs (cold)
    vi.advanceTimersByTime(TWENTY_FOUR_HOURS_MS + 1); // past the window
    await interceptor(); // runs again

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('records a sweep run on success', async () => {
    vi.setSystemTime(new Date('2026-06-14T12:00:00.000Z'));
    const { createSweepInterceptor, recordSweepRun } = await importFactory();

    const interceptor = createSweepInterceptor({
      name: 'recovery-expiry',
      throttleMs: TWENTY_FOUR_HOURS_MS,
      run: vi.fn().mockResolvedValue(undefined),
    });

    await interceptor();

    expect(recordSweepRun).toHaveBeenCalledTimes(1);
    expect(recordSweepRun).toHaveBeenCalledWith(
      'recovery-expiry',
      expect.any(Number)
    );
  });

  it('NEVER throws when run() rejects — records the error + reports it', async () => {
    vi.setSystemTime(new Date('2026-06-14T12:00:00.000Z'));
    const { createSweepInterceptor, recordSweepRun, reportIssueBackend } =
      await importFactory();

    const interceptor = createSweepInterceptor({
      name: 'recovery-expiry',
      throttleMs: TWENTY_FOUR_HOURS_MS,
      run: vi.fn().mockRejectedValue(new Error('boom')),
    });

    // Must resolve, not reject — a sweep failure must never block the request.
    await expect(interceptor()).resolves.toBeUndefined();

    expect(recordSweepRun).toHaveBeenCalledWith(
      'recovery-expiry',
      expect.any(Number),
      'boom'
    );
    expect(reportIssueBackend).toHaveBeenCalledTimes(1);
    expect(reportIssueBackend).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'error' })
    );
  });

  it('marks the throttle BEFORE async work (a slow run still blocks re-entry)', async () => {
    vi.setSystemTime(new Date('2026-06-14T12:00:00.000Z'));
    const { createSweepInterceptor } = await importFactory();

    let resolveRun: (() => void) | undefined;
    const run = vi.fn(
      () =>
        new Promise<void>(resolve => {
          resolveRun = resolve;
        })
    );
    const interceptor = createSweepInterceptor({
      name: 'pairing-cleanup',
      throttleMs: TWENTY_FOUR_HOURS_MS,
      run,
    });

    const first = interceptor(); // starts, marks lastRunAt, awaits run
    await interceptor(); // concurrent re-entry on same instance — must be throttled
    resolveRun?.();
    await first;

    expect(run).toHaveBeenCalledTimes(1);
  });
});
