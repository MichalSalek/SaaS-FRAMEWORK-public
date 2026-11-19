/**
 * Unit tests — throttle counter stores: fixed-window renewal and window end in memory, atomic
 * counts under parallel hits, and the resilient wrapper falling back to memory when the table is
 * unreachable. The SQL upsert's atomicity under concurrent sessions has no automated test
 * (it was checked by hand on the dev database).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));
vi.mock('@app/db/db.client', () => ({ DB_CLIENT: {} }));

import {
  createMemoryThrottleCounterStore,
  createResilientThrottleCounterStore,
  type ThrottleCounterStore,
} from './throttle-counter.store';
import { reportIssueBackend } from '@app/debugger/error-handler';

const WINDOW = 1000;
const at = (ms: number) => new Date(Date.UTC(2026, 9, 22) + ms);

describe('memory throttle counter store', () => {
  it('counts inside a window, reports its end, and restarts at 1 when it closes', async () => {
    const store = createMemoryThrottleCounterStore();
    expect(await store.hit('k', WINDOW, at(0))).toEqual({
      count: 1,
      resetAt: at(1000),
    });
    // The window is anchored on the first hit, not slid by later ones.
    expect(await store.hit('k', WINDOW, at(999))).toEqual({
      count: 2,
      resetAt: at(1000),
    });
    expect(await store.hit('k', WINDOW, at(1000))).toEqual({
      count: 1,
      resetAt: at(2000),
    });
  });

  it('parallel hits get distinct consecutive counts', async () => {
    const store = createMemoryThrottleCounterStore();
    const counts = (
      await Promise.all(
        Array.from({ length: 30 }, () => store.hit('k', WINDOW, at(0)))
      )
    ).map(h => h.count);
    expect([...counts].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 30 }, (_, i) => i + 1)
    );
  });

  it('keys are independent', async () => {
    const store = createMemoryThrottleCounterStore();
    await store.hit('a', WINDOW, at(0));
    await store.hit('a', WINDOW, at(0));
    expect((await store.hit('b', WINDOW, at(0))).count).toBe(1);
  });
});

describe('resilient throttle counter store', () => {
  it('falls back to memory and reports when the primary throws', async () => {
    const broken: ThrottleCounterStore = {
      hit: () => Promise.reject(new Error('db down')),
    };
    const store = createResilientThrottleCounterStore(broken);
    expect((await store.hit('k', WINDOW, at(0))).count).toBe(1);
    expect((await store.hit('k', WINDOW, at(1))).count).toBe(2);
    expect(vi.mocked(reportIssueBackend)).toHaveBeenCalled();
  });

  it('uses the primary while it works', async () => {
    const primary = createMemoryThrottleCounterStore();
    const fallback = createMemoryThrottleCounterStore();
    const store = createResilientThrottleCounterStore(primary, fallback);
    await store.hit('k', WINDOW, at(0));
    expect((await primary.hit('k', WINDOW, at(0))).count).toBe(2);
    expect((await fallback.hit('k', WINDOW, at(0))).count).toBe(1);
  });
});
