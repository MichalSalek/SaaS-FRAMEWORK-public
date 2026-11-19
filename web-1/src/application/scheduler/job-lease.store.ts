import {
  CLAIM_JOB_SQL,
  COMPLETE_JOB_SQL,
  FAIL_JOB_SQL,
  READ_JOBS_SQL,
  RENEW_JOB_SQL,
  type ClaimRow,
  type FinishRow,
  type JobLeaseRow,
  type RenewRow,
} from './job-lease.sql';

/** Positional parameters of one statement ($1, $2, ...). */
export type SqlParam = string | number | null;

/**
 * Run one parameterized statement and return its rows. With `statementTimeoutMs` the statement
 * runs in its own transaction under `SET LOCAL statement_timeout` (transaction-scoped, so safe
 * under PgBouncer transaction pooling).
 */
export type SqlExec = <T>(
  sql: string,
  params: ReadonlyArray<SqlParam>,
  options?: { statementTimeoutMs?: number }
) => Promise<T[]>;

/**
 * The durable side of the scheduler. Every method is one statement (job-lease.sql.ts), so the
 * store has no connection affinity and works through any pool, PgBouncer transaction mode
 * included. `false` from renew/complete/fail means the caller no longer owns the lease.
 */
export type JobLeaseStore = {
  claim: (
    jobName: string,
    owner: string,
    leaseTtlMs: number,
    earlyMs: number
  ) => Promise<boolean>;
  renew: (
    jobName: string,
    owner: string,
    leaseTtlMs: number,
    statementTimeoutMs: number
  ) => Promise<boolean>;
  complete: (
    jobName: string,
    owner: string,
    intervalMs: number,
    durationMs: number,
    instance: string
  ) => Promise<boolean>;
  fail: (
    jobName: string,
    owner: string,
    retryMs: number,
    durationMs: number,
    error: string,
    instance: string
  ) => Promise<boolean>;
  readAll: () => Promise<JobLeaseRow[]>;
};

/** Stored error text is capped: it is a hint for the admin, the full error goes to the logs. */
const MAX_ERROR_LENGTH = 500;

export const createJobLeaseStore = (exec: SqlExec): JobLeaseStore => ({
  claim: async (jobName, owner, leaseTtlMs, earlyMs) => {
    const rows = await exec<ClaimRow>(CLAIM_JOB_SQL, [
      jobName,
      owner,
      leaseTtlMs,
      earlyMs,
    ]);
    return rows.length === 1;
  },
  renew: async (jobName, owner, leaseTtlMs, statementTimeoutMs) => {
    const rows = await exec<RenewRow>(
      RENEW_JOB_SQL,
      [jobName, owner, leaseTtlMs],
      { statementTimeoutMs }
    );
    return rows.length === 1;
  },
  complete: async (jobName, owner, intervalMs, durationMs, instance) => {
    const rows = await exec<FinishRow>(COMPLETE_JOB_SQL, [
      jobName,
      owner,
      intervalMs,
      Math.round(durationMs),
      instance,
    ]);
    return rows.length === 1;
  },
  fail: async (jobName, owner, retryMs, durationMs, error, instance) => {
    const rows = await exec<FinishRow>(FAIL_JOB_SQL, [
      jobName,
      owner,
      retryMs,
      Math.round(durationMs),
      error.slice(0, MAX_ERROR_LENGTH),
      instance,
    ]);
    return rows.length === 1;
  },
  readAll: () => exec<JobLeaseRow>(READ_JOBS_SQL, []),
});
