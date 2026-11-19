import { describe, it, expect, vi } from 'vitest';
import type * as RunAfterResponseModule from './run-after-response';

/**
 * Exercises the non-Vercel (Render) tracking + drain path. Under vitest
 * `process.env.VERCEL` is unset, so `runAfterResponse` takes the tracked
 * branch (not the waitUntil branch).
 *
 * NOTE: setup.ts globally mocks '@app/runtime/run-after-response' to a no-op
 * (so other tests never fire real background I/O). We deliberately load the
 * REAL module here via importActual to test the actual drain machinery.
 */
const { runAfterResponse, drainAfterResponseTasks } = await vi.importActual<
  typeof RunAfterResponseModule
>('./run-after-response');
describe('runAfterResponse drain-on-shutdown', () => {
  it('does NOT block the caller — the effect is still pending after scheduling', () => {
    let landed = false;
    runAfterResponse(async () => {
      await new Promise(r => setTimeout(r, 30));
      landed = true;
    });
    // Handler-equivalent returned synchronously; the effect has not run yet.
    expect(landed).toBe(false);
    return drainAfterResponseTasks(1_000); // cleanup so the task does not leak
  });

  it('drainAfterResponseTasks awaits an in-flight effect to completion', async () => {
    let landed = false;
    runAfterResponse(async () => {
      await new Promise(r => setTimeout(r, 30));
      landed = true;
    });
    const drained = await drainAfterResponseTasks(1_000);
    expect(landed).toBe(true);
    expect(drained).toBe(1); // returns how many effects were in flight
  });

  it('is a no-op (returns 0) when nothing is in flight', async () => {
    await expect(drainAfterResponseTasks(1_000)).resolves.toBe(0);
  });

  it('caps at the timeout for a hung effect (never blocks the exit)', async () => {
    let release: () => void = () => {};
    runAfterResponse(() => new Promise<void>(r => (release = r)));
    const start = Date.now();
    await drainAfterResponseTasks(50);
    expect(Date.now() - start).toBeLessThan(500); // returned near the 50ms cap
    release(); // resolve the hung task so it clears from the tracking set
    await drainAfterResponseTasks(1_000);
  });
});

describe('drain keeps watching (closing review s34)', () => {
  it('drains an effect queued AFTER the drain started (request still in flight)', async () => {
    let landed = false;
    setTimeout(() => {
      runAfterResponse(async () => {
        // Longer than the 100 ms poll, so the drain must actually wait for it.
        await new Promise(r => setTimeout(r, 300));
        landed = true;
      });
    }, 150);
    const drained = await drainAfterResponseTasks(2_000, 400);
    expect(landed).toBe(true);
    expect(drained).toBe(1);
  });

  it('shares ONE set across module copies (globalThis), the double-bundle case', async () => {
    vi.resetModules();
    const second = await vi.importActual<typeof RunAfterResponseModule>(
      './run-after-response'
    );
    let landed = false;
    second.runAfterResponse(async () => {
      await new Promise(r => setTimeout(r, 20));
      landed = true;
    });
    // The drain from the FIRST copy sees the task added through the second.
    await expect(drainAfterResponseTasks(1_000, 50)).resolves.toBe(1);
    expect(landed).toBe(true);
  });
});
