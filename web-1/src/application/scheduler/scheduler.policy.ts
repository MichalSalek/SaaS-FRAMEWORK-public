import { TIME } from '@kernel/application/constants.config';
import { EMAIL_LIFECYCLE_CONFIG } from '@kernel/domain/email/email-schedule.config';
import { isEmailQuietHours } from '@app/email-handler/email-lifecycle.state';
import type { JobLeaseRow } from './job-lease.sql';
import type { ScheduledJob } from './scheduled-job';
import { SCHEDULER_CONFIG } from './scheduler.config';

/** What the scheduler knows about one job (one `JobLease` row). */
export type JobState = {
  dueAtMs: number;
  leaseExpiresAtMs: number | null;
  lastCompletedAtMs: number | null;
  lastDurationMs: number | null;
  lastError: string | null;
  lastInstance: string | null;
  consecutiveFailures: number;
  runCount: number;
};

export type JobStates = ReadonlyMap<string, JobState>;

export const toJobStates = (rows: ReadonlyArray<JobLeaseRow>): JobStates =>
  new Map(
    rows.map(row => [
      row.job_name,
      {
        dueAtMs: row.due_at_ms,
        leaseExpiresAtMs: row.lease_expires_at_ms,
        lastCompletedAtMs: row.last_completed_at_ms,
        lastDurationMs: row.last_duration_ms,
        lastError: row.last_error,
        lastInstance: row.last_instance,
        consecutiveFailures: row.consecutive_failures,
        runCount: row.run_count,
      },
    ])
  );

/**
 * DECISION: the tick never wakes the database inside mail quiet hours (21:00-09:00 UTC), the
 * owner's Neon budget rule of 2026-09-23 carried over to the single clock: at zero traffic the
 * database wakes about every 6 h in daytime and sleeps all night. Every lateness deadline is
 * measured from the first moment the tick was allowed to act, so the night is never "late".
 */
export const isTickQuietAt = (atMs: number): boolean =>
  isEmailQuietHours(new Date(atMs));

/** The first moment at or after `atMs` outside the quiet window. */
export const nextTickWindowStart = (atMs: number): number => {
  if (!isTickQuietAt(atMs)) {
    return atMs;
  }
  const end = new Date(atMs);
  end.setUTCHours(EMAIL_LIFECYCLE_CONFIG.QUIET_HOURS_END, 0, 0, 0);
  return end.getTime() > atMs ? end.getTime() : end.getTime() + TIME.MS_PER_DAY;
};

/**
 * The longest a non-waking job can wait for a database wake at zero traffic: the shortest
 * interval among the jobs that wake it.
 */
export const tickWakeFloorMs = (jobs: ReadonlyArray<ScheduledJob>): number =>
  Math.min(...jobs.filter(job => job.wakesOnTick).map(job => job.intervalMs));

/** After this moment a job that is still due is late (traffic or no traffic). */
export const lateDeadlineMs = (
  job: ScheduledJob,
  dueAtMs: number,
  wakeFloorMs: number
): number =>
  nextTickWindowStart(job.wakesOnTick ? dueAtMs : dueAtMs + wakeFloorMs) +
  SCHEDULER_CONFIG.LATENESS_GRACE_MS;

export type JobHealth = 'ok' | 'late' | 'failing' | 'never_run';

export const jobHealth = (
  job: ScheduledJob,
  state: JobState | undefined,
  nowMs: number,
  wakeFloorMs: number
): JobHealth => {
  if (state === undefined) {
    return 'never_run';
  }
  if (state.consecutiveFailures >= SCHEDULER_CONFIG.MAX_CONSECUTIVE_FAILURES) {
    return 'failing';
  }
  return nowMs > lateDeadlineMs(job, state.dueAtMs, wakeFloorMs)
    ? 'late'
    : 'ok';
};

/** Jobs worth a claim attempt now. Unknown state = try (the first claim creates the row). */
export const selectDueJobs = (
  jobs: ReadonlyArray<ScheduledJob>,
  states: JobStates | null,
  nowMs: number,
  earlyMs: number
): ScheduledJob[] =>
  jobs.filter(job => {
    if (job.canRunAt && !job.canRunAt(new Date(nowMs))) {
      return false;
    }
    const state = states?.get(job.name);
    if (state === undefined) {
      return true;
    }
    const leaseLive =
      state.leaseExpiresAtMs !== null && state.leaseExpiresAtMs > nowMs;
    return state.dueAtMs <= nowMs + earlyMs && !leaseLive;
  });

export type TickDecision = {
  /** Start a round (wakes the database). */
  wake: boolean;
  /**
   * Jobs still unhealthy although a round already ran after their deadline: the clock arrives
   * but the work does not get done. The tick answers 503 so the Better Stack monitor alerts.
   */
  alarm: string[];
};

/**
 * Decide a tick from memory only (no database), so a tick that has nothing to do keeps Neon
 * asleep. `states` is what the last round of this process read; `null` = nothing read yet.
 */
/** Alarm name for rounds that fail as a whole (no job table read, no claim). */
export const SCHEDULER_ROUND_ALARM = 'scheduler-round';

export const decideTick = ({
  jobs,
  states,
  nowMs,
  lastRoundFinishedAtMs,
  consecutiveFailedRounds,
}: {
  jobs: ReadonlyArray<ScheduledJob>;
  states: JobStates | null;
  nowMs: number;
  lastRoundFinishedAtMs: number;
  consecutiveFailedRounds: number;
}): TickDecision => {
  const quiet = isTickQuietAt(nowMs);
  // A round that cannot read or claim leaves `states` stale or null, and per-job lateness then
  // never fires: the failed rounds themselves are the alarm. With no state ever read, the first
  // failed attempt already alarms (nothing else could).
  const roundAlarm =
    consecutiveFailedRounds >= SCHEDULER_CONFIG.MAX_CONSECUTIVE_FAILED_ROUNDS ||
    (states === null && consecutiveFailedRounds > 0)
      ? [SCHEDULER_ROUND_ALARM]
      : [];
  if (states === null) {
    return { wake: !quiet, alarm: roundAlarm };
  }
  const floor = tickWakeFloorMs(jobs);
  const wakingDue = selectDueJobs(
    jobs.filter(job => job.wakesOnTick),
    states,
    nowMs,
    SCHEDULER_CONFIG.TICK_EARLY_MS
  );
  const alarm = jobs
    .filter(job => {
      const state = states.get(job.name);
      const health = jobHealth(job, state, nowMs, floor);
      if (health === 'failing') {
        return true;
      }
      return (
        health === 'late' &&
        state !== undefined &&
        lastRoundFinishedAtMs > lateDeadlineMs(job, state.dueAtMs, floor)
      );
    })
    .map(job => job.name);
  return {
    wake: !quiet && wakingDue.length > 0,
    alarm: [...roundAlarm, ...alarm],
  };
};

/** `host:pid:bootMs`; the boot time lets two processes tell a deploy overlap from two instances. */
export const parseInstanceBootMs = (instance: string): number | null => {
  const last = instance.split(':').pop();
  const value = last === undefined ? Number.NaN : Number(last);
  return Number.isFinite(value) ? value : null;
};

/**
 * Another process completed a job long after both processes were up: two instances run at
 * once. Returns that instance id, or null.
 */
export const detectSecondInstance = ({
  states,
  ownInstance,
  ownBootMs,
}: {
  states: JobStates;
  ownInstance: string;
  ownBootMs: number;
}): string | null => {
  for (const state of states.values()) {
    if (
      state.lastInstance === null ||
      state.lastInstance === ownInstance ||
      state.lastCompletedAtMs === null
    ) {
      continue;
    }
    const otherBootMs = parseInstanceBootMs(state.lastInstance);
    if (otherBootMs === null) {
      continue;
    }
    const bothUpSince = Math.max(ownBootMs, otherBootMs);
    if (
      state.lastCompletedAtMs >
      bothUpSince + SCHEDULER_CONFIG.INSTANCE_OVERLAP_GRACE_MS
    ) {
      return state.lastInstance;
    }
  }
  return null;
};
