import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { ReportIssueProps } from '@app/debugger/error-debugger.types';
import { TIME } from '@kernel/application/constants.config';
import type { JobLeaseStore } from './job-lease.store';
import { runLeasedJob, type LeasedRunOutcome } from './job-runner';
import type { ScheduledJob } from './scheduled-job';
import { SCHEDULER_CONFIG } from './scheduler.config';
import {
  decideTick,
  detectSecondInstance,
  jobHealth,
  lateDeadlineMs,
  selectDueJobs,
  tickWakeFloorMs,
  toJobStates,
  type JobStates,
  type TickDecision,
} from './scheduler.policy';

export type SchedulerTrigger = 'tick' | 'traffic';

/** Process-local memory of the scheduler. Never a source of truth: `JobLease` is. */
export type SchedulerState = {
  /** `host:pid:bootMs` of this process. */
  instance: string;
  bootMs: number;
  /** Last `JobLease` read of this process; `null` before the first round. */
  states: JobStates | null;
  /** Claim phase of a round in progress (one at a time per process). */
  claiming: boolean;
  /** Jobs this process is running right now (a later round skips them). */
  running: Set<string>;
  lastRoundStartedAtMs: number;
  lastRoundFinishedAtMs: number;
  /**
   * Rounds in a row that could not read the job table or claim a job. A clock that arrives
   * while every round fails (database unreachable, table missing) must still alarm, also when
   * no state was ever read.
   */
  consecutiveFailedRounds: number;
  /** `name@dueAtMs` already reported late, so one late due interval is reported once. */
  reportedLate: Set<string>;
  reportedSecondInstance: string | null;
};

export const createSchedulerState = (
  nowMs: number = Date.now()
): SchedulerState => ({
  instance: `${hostname()}:${process.pid}:${nowMs}`,
  bootMs: nowMs,
  states: null,
  claiming: false,
  running: new Set(),
  lastRoundStartedAtMs: 0,
  lastRoundFinishedAtMs: 0,
  consecutiveFailedRounds: 0,
  reportedLate: new Set(),
  reportedSecondInstance: null,
});

export type SchedulerDeps = {
  jobs: ReadonlyArray<ScheduledJob>;
  store: JobLeaseStore;
  state: SchedulerState;
  report: (issue: ReportIssueProps) => void;
  nowMs?: () => number;
};

export type RoundResult = {
  trigger: SchedulerTrigger;
  outcomes: Array<{ name: string; outcome: LeasedRunOutcome }>;
};

export type Scheduler = {
  /** Claim and run every due job; resolves when the jobs this round started have finished. */
  runRound: (trigger: SchedulerTrigger) => Promise<RoundResult | null>;
  /** Memory-only decision for the external tick. */
  decideTick: () => TickDecision;
};

export const createScheduler = ({
  jobs,
  store,
  state,
  report,
  nowMs = () => Date.now(),
}: SchedulerDeps): Scheduler => {
  const wakeFloorMs = tickWakeFloorMs(jobs);

  const reportLateJobs = (
    states: JobStates,
    trigger: SchedulerTrigger,
    atMs: number
  ): void => {
    for (const job of jobs) {
      const jobState = states.get(job.name);
      if (
        jobState === undefined ||
        jobHealth(job, jobState, atMs, wakeFloorMs) !== 'late'
      ) {
        continue;
      }
      const key = `${job.name}@${jobState.dueAtMs}`;
      if (state.reportedLate.has(key)) {
        continue;
      }
      state.reportedLate.add(key);
      const lateByMinutes = Math.round(
        (atMs - lateDeadlineMs(job, jobState.dueAtMs, wakeFloorMs)) /
          TIME.MS_PER_MINUTE
      );
      // DECISION: traffic finding a late job means the external clock did not run it (tick
      // monitor paused, endpoint failing, Render asleep): that is the in-app alarm of a dead
      // clock, so it is an error (PostHog alert). A tick finding it means the clock is back.
      report({
        namespace: 'SCHEDULER',
        message:
          trigger === 'traffic'
            ? `Job "${job.name}" is late by ${lateByMinutes} min: the external tick did not run it, traffic caught it`
            : `Job "${job.name}" was late by ${lateByMinutes} min: the external tick is back`,
        payload: {
          job: job.name,
          dueAt: new Date(jobState.dueAtMs).toISOString(),
          trigger,
        },
        mode: trigger === 'traffic' ? 'error' : 'warn',
      });
    }
  };

  const reportOutcome = (name: string, outcome: LeasedRunOutcome): void => {
    if (outcome.status === 'failed') {
      report({
        namespace: `${name}-sweep`,
        message: `Sweep "${name}" failed`,
        payload: {
          error: outcome.error,
          durationMs: Math.round(outcome.durationMs),
        },
        mode: 'error',
      });
    }
    if (outcome.status !== 'not-claimed' && outcome.fenced) {
      report({
        namespace: 'SCHEDULER',
        message: `Job "${name}" finished without its lease; the result was not recorded`,
        payload: { job: name, status: outcome.status },
        mode: 'warn',
      });
    }
  };

  type JobRun = {
    name: string;
    outcome: LeasedRunOutcome;
    /** The claim itself threw (database unreachable): nothing ran, the round failed. */
    claimFailed: boolean;
  };

  const runOne = async (
    job: ScheduledJob,
    earlyMs: number
  ): Promise<JobRun> => {
    state.running.add(job.name);
    try {
      const outcome = await runLeasedJob({
        job: {
          name: job.name,
          intervalMs: job.intervalMs,
          leaseTtlMs: job.leaseTtlMs ?? SCHEDULER_CONFIG.DEFAULT_LEASE_TTL_MS,
          run: job.run,
        },
        store,
        owner: `${state.instance}#${randomUUID()}`,
        instance: state.instance,
        earlyMs,
        failureRetryMs: SCHEDULER_CONFIG.FAILURE_RETRY_MS,
      });
      reportOutcome(job.name, outcome);
      return { name: job.name, outcome, claimFailed: false };
    } catch (error) {
      // A claim that could not reach the database: nothing was run, nothing is owned.
      report({
        namespace: 'SCHEDULER',
        message: `Claiming job "${job.name}" failed`,
        payload: error,
        mode: 'error',
      });
      return {
        name: job.name,
        outcome: { status: 'not-claimed' },
        claimFailed: true,
      };
    } finally {
      state.running.delete(job.name);
    }
  };

  const refreshStates = async (): Promise<JobStates> => {
    const states = toJobStates(await store.readAll());
    state.states = states;
    const second = detectSecondInstance({
      states,
      ownInstance: state.instance,
      ownBootMs: state.bootMs,
    });
    if (second !== null && second !== state.reportedSecondInstance) {
      state.reportedSecondInstance = second;
      report({
        namespace: 'SCHEDULER',
        message:
          'A second backend instance runs scheduled jobs; the in-memory request limiter assumes one instance (D11)',
        payload: { own: state.instance, other: second },
        mode: 'error',
      });
    }
    return states;
  };

  const runRound = async (
    trigger: SchedulerTrigger
  ): Promise<RoundResult | null> => {
    const startMs = nowMs();
    if (state.claiming) {
      return null;
    }
    if (trigger === 'traffic') {
      if (
        startMs - state.lastRoundStartedAtMs <
        SCHEDULER_CONFIG.TRAFFIC_ROUND_MIN_SPACING_MS
      ) {
        return null;
      }
      // Memory says nothing is due: no database round trip at all.
      if (
        state.states !== null &&
        selectDueJobs(jobs, state.states, startMs, 0).length === 0
      ) {
        return null;
      }
    }

    state.claiming = true;
    state.lastRoundStartedAtMs = startMs;
    let started: Array<Promise<JobRun>>;
    try {
      const before = await refreshStates();
      reportLateJobs(before, trigger, startMs);
      const earlyMs = trigger === 'tick' ? SCHEDULER_CONFIG.TICK_EARLY_MS : 0;
      started = selectDueJobs(jobs, before, startMs, earlyMs)
        .filter(job => !state.running.has(job.name))
        .map(job => runOne(job, earlyMs));
    } catch (error) {
      report({
        namespace: 'SCHEDULER',
        message: 'Scheduler round could not read the job table',
        payload: error,
        mode: 'error',
      });
      state.consecutiveFailedRounds += 1;
      return null;
    } finally {
      state.claiming = false;
    }

    const runs = await Promise.all(started);
    let failed = runs.some(run => run.claimFailed);
    try {
      await refreshStates();
      state.lastRoundFinishedAtMs = nowMs();
    } catch (error) {
      failed = true;
      report({
        namespace: 'SCHEDULER',
        message: 'Scheduler round could not re-read the job table',
        payload: error,
        mode: 'warn',
      });
    }
    state.consecutiveFailedRounds = failed
      ? state.consecutiveFailedRounds + 1
      : 0;
    return {
      trigger,
      outcomes: runs.map(({ name, outcome }) => ({ name, outcome })),
    };
  };

  return {
    runRound,
    decideTick: () =>
      decideTick({
        jobs,
        states: state.states,
        nowMs: nowMs(),
        lastRoundFinishedAtMs: state.lastRoundFinishedAtMs,
        consecutiveFailedRounds: state.consecutiveFailedRounds,
      }),
  };
};
