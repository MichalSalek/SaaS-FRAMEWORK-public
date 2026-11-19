import type { ScheduledJob } from '@app/scheduler/scheduled-job';
import type { JobLeaseRow } from '@app/scheduler/job-lease.sql';

/** Shared fixtures of the scheduler unit tests. */
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const NOON = Date.parse('2026-10-23T12:00:00Z');

export const makeJobs = () => {
  const runs = { daily: 0, sixHour: 0, minute: 0 };
  const jobs: ScheduledJob[] = [
    {
      name: 'pairing-cleanup',
      intervalMs: 24 * HOUR,
      wakesOnTick: true,
      run: async () => {
        runs.daily += 1;
      },
    },
    {
      name: 'session-container-expiry',
      intervalMs: 6 * HOUR,
      wakesOnTick: true,
      run: async () => {
        runs.sixHour += 1;
      },
    },
    {
      name: 'stripe-event-janitor',
      intervalMs: MINUTE,
      wakesOnTick: false,
      run: async () => {
        runs.minute += 1;
      },
    },
  ];
  return { jobs, runs };
};

export function row(name: string, dueAtMs: number): JobLeaseRow {
  return {
    job_name: name,
    due_at_ms: dueAtMs,
    lease_owner: null,
    lease_expires_at_ms: null,
    last_started_at_ms: null,
    last_completed_at_ms: dueAtMs - HOUR,
    last_duration_ms: 1,
    last_error: null,
    last_instance: null,
    consecutive_failures: 0,
    run_count: 1,
    db_now_ms: NOON,
  };
}
