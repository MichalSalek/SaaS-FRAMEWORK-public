import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryJobLeaseStore } from '../../test-utils/in-memory-job-lease.store';
import { JobLeaseLostError, runLeasedJob, type LeasedJob } from './job-runner';

const MINUTE = 60_000;

describe('runLeasedJob', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-23T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = () => {
    const store = createInMemoryJobLeaseStore(() => Date.now());
    const base = {
      store,
      instance: 'host:1:0',
      earlyMs: 0,
      failureRetryMs: 15 * MINUTE,
      monotonicNow: () => Date.now(),
    };
    return { store, base };
  };

  it('does not accept completion or failure after lease expiry before takeover', async () => {
    const { store } = setup();
    expect(await store.claim('j', 'a', 1_000, 0)).toBe(true);
    vi.setSystemTime(Date.now() + 1_001);
    expect(await store.complete('j', 'a', 60_000, 1, 'a')).toBe(false);
    expect(await store.fail('j', 'a', 60_000, 1, 'late', 'a')).toBe(false);
    expect(await store.claim('j', 'b', 1_000, 0)).toBe(true);
  });

  it('runs a due job once and moves due_at one interval past completion', async () => {
    const { store, base } = setup();
    const run = vi.fn(async () => undefined);
    const job: LeasedJob = {
      name: 'j',
      intervalMs: 60 * MINUTE,
      leaseTtlMs: 2 * MINUTE,
      run,
    };

    const first = await runLeasedJob({ ...base, job, owner: 'a' });
    const second = await runLeasedJob({ ...base, job, owner: 'b' });

    expect(first.status).toBe('completed');
    expect(second.status).toBe('not-claimed');
    expect(run).toHaveBeenCalledOnce();
    expect(store.rows.get('j')?.due_at_ms).toBe(Date.now() + 60 * MINUTE);
    expect(store.rows.get('j')?.run_count).toBe(1);
  });

  it('runs a job late by days exactly once (no catch-up avalanche)', async () => {
    const { store, base } = setup();
    const run = vi.fn(async () => undefined);
    const job: LeasedJob = {
      name: 'j',
      intervalMs: 60 * MINUTE,
      leaseTtlMs: 2 * MINUTE,
      run,
    };
    await runLeasedJob({ ...base, job, owner: 'a' });

    vi.setSystemTime(Date.now() + 5 * 24 * 60 * MINUTE);
    for (const owner of ['b', 'c', 'd']) {
      await runLeasedJob({ ...base, job, owner });
    }

    expect(run).toHaveBeenCalledTimes(2);
    expect(store.rows.get('j')?.run_count).toBe(2);
  });

  it('retries a failed run after min(interval, failure retry) and counts failures', async () => {
    const { store, base } = setup();
    const job: LeasedJob = {
      name: 'j',
      intervalMs: 6 * 60 * MINUTE,
      leaseTtlMs: 2 * MINUTE,
      run: async () => {
        throw new Error('boom');
      },
    };
    const outcome = await runLeasedJob({ ...base, job, owner: 'a' });

    expect(outcome).toMatchObject({
      status: 'failed',
      error: 'boom',
      fenced: false,
    });
    expect(store.rows.get('j')).toMatchObject({
      due_at_ms: Date.now() + 15 * MINUTE,
      consecutive_failures: 1,
      last_error: 'boom',
      lease_owner: null,
    });
  });

  it('renews the lease while a long body runs, so nobody else can claim it', async () => {
    const { store, base } = setup();
    let release: () => void = () => undefined;
    const job: LeasedJob = {
      name: 'j',
      intervalMs: 60 * MINUTE,
      leaseTtlMs: 3 * MINUTE,
      run: () => new Promise<void>(resolve => (release = resolve)),
    };
    const running = runLeasedJob({ ...base, job, owner: 'a' });
    await vi.advanceTimersByTimeAsync(10 * MINUTE);

    const other = await runLeasedJob({
      ...base,
      job: { ...job, run: async () => undefined },
      owner: 'b',
    });
    expect(other.status).toBe('not-claimed');
    expect(store.rows.get('j')?.lease_owner).toBe('a');

    release();
    await expect(running).resolves.toMatchObject({
      status: 'completed',
      fenced: false,
    });
  });

  it('aborts the body and writes nothing once the lease was taken over', async () => {
    const { store, base } = setup();
    let seenSignal: AbortSignal | null = null;
    let release: () => void = () => undefined;
    const job: LeasedJob = {
      name: 'j',
      intervalMs: 60 * MINUTE,
      leaseTtlMs: 3 * MINUTE,
      run: ({ signal }) => {
        seenSignal = signal;
        return new Promise<void>(resolve => (release = resolve));
      },
    };
    const running = runLeasedJob({ ...base, job, owner: 'a' });
    await Promise.resolve();
    // A stalled owner: its lease expires and another process takes the job.
    const row = store.rows.get('j');
    if (row === undefined) {
      throw new Error('row missing');
    }
    store.rows.set('j', {
      ...row,
      lease_owner: 'b',
      lease_expires_at_ms: Date.now() + 3 * MINUTE,
    });

    await vi.advanceTimersByTimeAsync(MINUTE + 1);
    expect(seenSignal).not.toBeNull();
    expect((seenSignal as AbortSignal | null)?.aborted).toBe(true);
    expect((seenSignal as AbortSignal | null)?.reason).toBeInstanceOf(
      JobLeaseLostError
    );

    release();
    await expect(running).resolves.toMatchObject({
      status: 'completed',
      fenced: true,
    });
    expect(store.rows.get('j')).toMatchObject({
      lease_owner: 'b',
      run_count: 0,
    });
  });

  it('aborts at lease expiry while a renewal hangs, measured from before the claim', async () => {
    const { store, base } = setup();
    const claim = store.claim;
    // The claim round trip itself takes 30 s.
    vi.spyOn(store, 'claim').mockImplementation(async (...args) => {
      vi.setSystemTime(Date.now() + 30_000);
      return claim(...args);
    });
    vi.spyOn(store, 'renew').mockImplementation(
      () => new Promise<boolean>(() => undefined)
    );
    let seen: AbortSignal | null = null;
    const claimSentAt = Date.now();
    const job: LeasedJob = {
      name: 'j',
      intervalMs: 60 * MINUTE,
      leaseTtlMs: 3 * MINUTE,
      run: ({ signal }) =>
        new Promise<void>(resolve => {
          seen = signal;
          signal.addEventListener('abort', () => resolve());
        }),
    };
    const running = runLeasedJob({ ...base, job, owner: 'a' });
    let abortedAt = 0;
    while (abortedAt === 0) {
      await vi.advanceTimersByTimeAsync(1_000);
      if ((seen as AbortSignal | null)?.aborted) {
        abortedAt = Date.now();
      }
    }
    // Lease end is claimSentAt + ttl, not (claim answered) + ttl; detection lags one check.
    expect(abortedAt).toBeGreaterThanOrEqual(claimSentAt + 3 * MINUTE);
    expect(abortedAt).toBeLessThanOrEqual(claimSentAt + 3 * MINUTE + 31_000);
    await running;
  });

  it('a timed-out renewal is retried and a later success keeps the lease', async () => {
    const { store, base } = setup();
    const renew = store.renew;
    let calls = 0;
    vi.spyOn(store, 'renew').mockImplementation((...args) => {
      calls += 1;
      return calls === 1
        ? new Promise<boolean>(() => undefined)
        : renew(...args);
    });
    let seen: AbortSignal | null = null;
    let release: () => void = () => undefined;
    const job: LeasedJob = {
      name: 'j',
      intervalMs: 60 * MINUTE,
      leaseTtlMs: 3 * MINUTE,
      run: ({ signal }) => {
        seen = signal;
        return new Promise<void>(resolve => (release = resolve));
      },
    };
    const running = runLeasedJob({ ...base, job, owner: 'a' });
    await vi.advanceTimersByTimeAsync(10 * MINUTE);

    expect(calls).toBeGreaterThan(2);
    expect((seen as AbortSignal | null)?.aborted).toBe(false);
    release();
    await expect(running).resolves.toMatchObject({
      status: 'completed',
      fenced: false,
    });
  });
});
