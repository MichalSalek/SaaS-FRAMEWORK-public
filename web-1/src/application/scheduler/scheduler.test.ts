import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryJobLeaseStore } from '../../test-utils/in-memory-job-lease.store';
import { createScheduler, createSchedulerState } from './scheduler';
import { SCHEDULER_ROUND_ALARM, toJobStates } from './scheduler.policy';
import { toSchedulerServiceHealth, toSweepInfos } from './scheduler-health';
import {
  HOUR,
  MINUTE,
  NOON,
  makeJobs,
} from '../../test-utils/scheduler.fixtures';

vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));

describe('scheduler rounds', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOON);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const build = () => {
    const { jobs, runs } = makeJobs();
    const store = createInMemoryJobLeaseStore(() => Date.now());
    const readAll = vi.spyOn(store, 'readAll');
    const report = vi.fn();
    const process = (bootMs: number) =>
      createScheduler({
        jobs,
        store,
        state: createSchedulerState(bootMs),
        report,
      });
    return { jobs, runs, store, readAll, report, process };
  };

  it('runs each due job once although tick and traffic race in two processes', async () => {
    const { runs, store, process } = build();
    const a = process(NOON - HOUR);
    const b = process(NOON - HOUR);

    await Promise.all([
      a.runRound('tick'),
      b.runRound('tick'),
      a.runRound('traffic'),
      b.runRound('traffic'),
    ]);

    expect(runs).toEqual({ daily: 1, sixHour: 1, minute: 1 });
    expect([...store.rows.values()].every(r => r.lease_owner === null)).toBe(
      true
    );
  });

  it('does not touch the database on traffic while memory says nothing is due', async () => {
    const { readAll, process } = build();
    const scheduler = process(NOON);
    await scheduler.runRound('tick');
    readAll.mockClear();

    vi.setSystemTime(NOON + 30 * 1000);
    await scheduler.runRound('traffic');
    vi.setSystemTime(NOON + 50 * 1000);
    await scheduler.runRound('traffic');

    expect(readAll).not.toHaveBeenCalled();
  });

  it('tick failure: at zero traffic the job goes late, traffic catches it once and reports the dead clock', async () => {
    const { runs, report, jobs, store, process } = build();
    const scheduler = process(NOON);
    await scheduler.runRound('tick');
    expect(runs).toEqual({ daily: 1, sixHour: 1, minute: 1 });

    // Two days without a single tick and without traffic.
    vi.setSystemTime(NOON + 48 * HOUR);
    const health = toSchedulerServiceHealth({
      jobs,
      states: toJobStates(await store.readAll()),
      nowMs: Date.now(),
      state: createSchedulerState(NOON),
      latencyMs: 1,
    });
    expect(health.status).toBe('degraded');
    expect(health.message).toContain('pairing-cleanup: spóźnione');

    await scheduler.runRound('traffic');

    expect(runs).toEqual({ daily: 2, sixHour: 2, minute: 2 });
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: 'SCHEDULER', mode: 'error' })
    );
    // Caught up: nothing late, nothing alarming.
    expect(scheduler.decideTick().alarm).toEqual([]);
    const sweeps = toSweepInfos(
      jobs,
      toJobStates(await store.readAll()),
      Date.now()
    );
    expect(sweeps.every(sweep => sweep.status === 'ok')).toBe(true);
  });

  it('raises the tick alarm when a job keeps failing', async () => {
    const { jobs, store, report } = build();
    const failing = jobs.map(job =>
      job.name === 'pairing-cleanup'
        ? {
            ...job,
            run: async () => {
              throw new Error('db down');
            },
          }
        : job
    );
    const scheduler = createScheduler({
      jobs: failing,
      store,
      state: createSchedulerState(NOON),
      report,
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await scheduler.runRound('tick');
      vi.setSystemTime(Date.now() + 16 * MINUTE);
    }
    expect(scheduler.decideTick().alarm).toEqual(['pairing-cleanup']);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'pairing-cleanup-sweep',
        mode: 'error',
      })
    );
  });

  it('alarms on the first failed attempt when no state was ever read', async () => {
    const { jobs, store, report } = build();
    vi.spyOn(store, 'readAll').mockRejectedValue(new Error('db unreachable'));
    const scheduler = createScheduler({
      jobs,
      store,
      state: createSchedulerState(NOON),
      report,
    });
    expect(scheduler.decideTick()).toEqual({ wake: true, alarm: [] });

    await scheduler.runRound('tick');

    expect(scheduler.decideTick().alarm).toEqual([SCHEDULER_ROUND_ALARM]);
  });

  it('alarms after three failed rounds although stale state looks healthy, and clears on success', async () => {
    const { jobs, store, report } = build();
    const scheduler = createScheduler({
      jobs,
      store,
      state: createSchedulerState(NOON),
      report,
    });
    await scheduler.runRound('tick');
    const readAll = vi
      .spyOn(store, 'readAll')
      .mockRejectedValue(new Error('db unreachable'));

    for (let round = 1; round <= 3; round += 1) {
      vi.setSystemTime(Date.now() + 2 * MINUTE);
      await scheduler.runRound('traffic');
      const alarm = scheduler.decideTick().alarm;
      expect(alarm.includes(SCHEDULER_ROUND_ALARM)).toBe(round >= 3);
    }

    readAll.mockRestore();
    vi.setSystemTime(Date.now() + 2 * MINUTE);
    await scheduler.runRound('traffic');
    expect(scheduler.decideTick().alarm).toEqual([]);
  });

  it('counts a round whose claims throw as failed', async () => {
    const { jobs, store, report } = build();
    vi.spyOn(store, 'claim').mockRejectedValue(new Error('connection reset'));
    const state = createSchedulerState(NOON);
    const scheduler = createScheduler({ jobs, store, state, report });

    await scheduler.runRound('tick');

    expect(state.consecutiveFailedRounds).toBe(1);
  });

  it('respects canRunAt: a due mail job is not claimed in quiet hours', async () => {
    const { store } = build();
    const run = vi.fn(async () => undefined);
    const scheduler = createScheduler({
      jobs: [
        {
          name: 'email-lifecycle',
          intervalMs: 6 * HOUR,
          wakesOnTick: true,
          canRunAt: now => now.getUTCHours() >= 9 && now.getUTCHours() < 21,
          run,
        },
      ],
      store,
      state: createSchedulerState(NOON),
      report: vi.fn(),
    });
    vi.setSystemTime(Date.parse('2026-10-23T22:00:00Z'));
    await scheduler.runRound('traffic');
    expect(run).not.toHaveBeenCalled();
    expect(store.rows.has('email-lifecycle')).toBe(false);
  });
});
