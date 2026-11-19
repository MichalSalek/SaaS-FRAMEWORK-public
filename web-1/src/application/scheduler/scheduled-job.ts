import type { JobRunContext } from './job-runner';
import type { OperationResult } from '@kernel/application/result.types';
import type { ScheduledJobName } from './job-names';

/**
 * One periodic job. Built ONLY through `defineScheduledJob` and listed in
 * scheduled-jobs.registry.ts (guard: tests/audit/sweep-interceptor.sh). A job body owns its
 * own "what happened" reporting; a thrown error is reported by the scheduler and retried after
 * SCHEDULER_CONFIG.FAILURE_RETRY_MS. Throttling, cross-process exclusion and timing are the
 * scheduler's (durable lease in `JobLease`): a body must not keep a `lastRunAt`, an in-flight
 * flag or an advisory lock of its own.
 */
export type ScheduledJob = {
  name: ScheduledJobName;
  /** Next due = completion + interval. Build from `TIME.*`. */
  intervalMs: number;
  /**
   * May the external tick wake a sleeping database (Neon scale-to-zero) for this job? Jobs
   * with `false` run whenever the database is awake anyway: on traffic, or in a round the
   * tick started for a waking job (within the 6 h wake floor by day, up to ~12.5 h overnight;
   * lateness deadlines in scheduler.policy.ts).
   */
  wakesOnTick: boolean;
  /** Lease length; defaults to SCHEDULER_CONFIG.DEFAULT_LEASE_TTL_MS. */
  leaseTtlMs?: number;
  /** A due job is not even claimed while this says no (mail quiet hours). */
  canRunAt?: (now: Date) => boolean;
  run: (context: JobRunContext) => Promise<void>;
};

/** Keeps the literal name, so the registry can check that each key holds the job of that name. */
export const defineScheduledJob = <Name extends ScheduledJobName>(
  job: ScheduledJob & { name: Name }
): ScheduledJob & { name: Name } => job;

/**
 * The data of a successful operation, or a thrown error the scheduler records as a failed run
 * (retry after 15 min, `consecutive_failures`, admin health). A job body must never turn a failed
 * operation into a completed run: that would move `due_at` a whole interval and hide the failure.
 */
export const unwrapJobResult = <T, E>(
  jobName: ScheduledJobName,
  result: OperationResult<T, E>
): T => {
  if (!result.success) {
    throw new Error(
      `${jobName}: operation failed (${JSON.stringify(result.error).slice(0, 300)})`
    );
  }
  return result.data;
};
