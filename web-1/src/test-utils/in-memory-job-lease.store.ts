import type { JobLeaseRow } from '@app/scheduler/job-lease.sql';
import type { JobLeaseStore } from '@app/scheduler/job-lease.store';

/**
 * In-memory twin of the SQL lease (job-lease.sql.ts) for unit tests: same claim, renew and
 * fence rules on an injectable clock. The real semantics are proven on Postgres in
 * tests/postgres/job-lease.test.ts; this twin only lets scheduler logic be tested without one.
 */
export const createInMemoryJobLeaseStore = (
  clock: () => number
): JobLeaseStore & { rows: Map<string, JobLeaseRow> } => {
  const rows = new Map<string, JobLeaseRow>();
  const blank = (jobName: string, now: number): JobLeaseRow => ({
    job_name: jobName,
    due_at_ms: now,
    lease_owner: null,
    lease_expires_at_ms: null,
    last_started_at_ms: null,
    last_completed_at_ms: null,
    last_duration_ms: null,
    last_error: null,
    last_instance: null,
    consecutive_failures: 0,
    run_count: 0,
    db_now_ms: now,
  });
  return {
    rows,
    claim: async (jobName, owner, leaseTtlMs, earlyMs) => {
      const now = clock();
      const row = rows.get(jobName) ?? blank(jobName, now);
      const free =
        row.lease_expires_at_ms === null || row.lease_expires_at_ms <= now;
      if (rows.has(jobName) && !(row.due_at_ms <= now + earlyMs && free)) {
        return false;
      }
      rows.set(jobName, {
        ...row,
        lease_owner: owner,
        lease_expires_at_ms: now + leaseTtlMs,
        last_started_at_ms: now,
      });
      return true;
    },
    renew: async (jobName, owner, leaseTtlMs) => {
      const now = clock();
      const row = rows.get(jobName);
      if (
        row === undefined ||
        row.lease_owner !== owner ||
        row.lease_expires_at_ms === null ||
        row.lease_expires_at_ms <= now
      ) {
        return false;
      }
      rows.set(jobName, { ...row, lease_expires_at_ms: now + leaseTtlMs });
      return true;
    },
    complete: async (jobName, owner, intervalMs, durationMs, instance) => {
      const now = clock();
      const row = rows.get(jobName);
      if (
        row === undefined ||
        row.lease_owner !== owner ||
        row.lease_expires_at_ms === null ||
        row.lease_expires_at_ms <= now
      ) {
        return false;
      }
      rows.set(jobName, {
        ...row,
        due_at_ms: now + intervalMs,
        lease_owner: null,
        lease_expires_at_ms: null,
        last_completed_at_ms: now,
        last_duration_ms: Math.round(durationMs),
        last_error: null,
        last_instance: instance,
        consecutive_failures: 0,
        run_count: row.run_count + 1,
      });
      return true;
    },
    fail: async (jobName, owner, retryMs, durationMs, error, instance) => {
      const now = clock();
      const row = rows.get(jobName);
      if (
        row === undefined ||
        row.lease_owner !== owner ||
        row.lease_expires_at_ms === null ||
        row.lease_expires_at_ms <= now
      ) {
        return false;
      }
      rows.set(jobName, {
        ...row,
        due_at_ms: now + retryMs,
        lease_owner: null,
        lease_expires_at_ms: null,
        last_duration_ms: Math.round(durationMs),
        last_error: error,
        last_instance: instance,
        consecutive_failures: row.consecutive_failures + 1,
      });
      return true;
    },
    readAll: async () =>
      [...rows.values()].map(row => ({ ...row, db_now_ms: clock() })),
  };
};
