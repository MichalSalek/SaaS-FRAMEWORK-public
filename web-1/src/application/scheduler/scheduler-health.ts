import type {
  ServiceHealthCheck,
  SweepInfo,
} from '@kernel/models/admin/admin.dto';
import { TIME } from '@kernel/application/constants.config';
import type { JobLeaseStore } from './job-lease.store';
import type { ScheduledJob } from './scheduled-job';
import type { SchedulerState } from './scheduler';
import {
  detectSecondInstance,
  jobHealth,
  lateDeadlineMs,
  tickWakeFloorMs,
  toJobStates,
  type JobStates,
} from './scheduler.policy';

/** Name of the scheduler row in the admin health services list. */
export const SCHEDULER_SERVICE_NAME = 'Harmonogram zadań';

/**
 * ADMIN_HEALTH `sweeps`, read from `JobLease` (durable and shared by every process, unlike the
 * in-memory tracker it replaces, which reset on every deploy). `stale` = late or failing.
 */
export const toSweepInfos = (
  jobs: ReadonlyArray<ScheduledJob>,
  states: JobStates,
  nowMs: number
): SweepInfo[] => {
  const floor = tickWakeFloorMs(jobs);
  return jobs.map(job => {
    const state = states.get(job.name);
    if (state === undefined) {
      return {
        name: job.name,
        status: 'never_run',
        last_run_at: null,
        last_duration_ms: null,
        last_error: null,
        stale_threshold_hours: 0,
      };
    }
    const health = jobHealth(job, state, nowMs, floor);
    return {
      name: job.name,
      status: health === 'ok' ? 'ok' : 'stale',
      last_run_at:
        state.lastCompletedAtMs === null
          ? null
          : new Date(state.lastCompletedAtMs).toISOString(),
      last_duration_ms: state.lastDurationMs,
      last_error: state.lastError,
      stale_threshold_hours:
        Math.round(
          ((lateDeadlineMs(job, state.dueAtMs, floor) - state.dueAtMs) /
            TIME.MS_PER_HOUR) *
            10
        ) / 10,
    };
  });
};

/**
 * One row in the admin health services list (and so in the `system_health_issues` badge, which
 * opens that list): degraded when a job is late, failing or has never run, or when a second
 * backend instance runs jobs (the in-memory request limiter assumes one, D11).
 */
export const toSchedulerServiceHealth = ({
  jobs,
  states,
  nowMs,
  state,
  latencyMs,
}: {
  jobs: ReadonlyArray<ScheduledJob>;
  states: JobStates;
  nowMs: number;
  state: SchedulerState;
  latencyMs: number;
}): ServiceHealthCheck => {
  const floor = tickWakeFloorMs(jobs);
  const problems = jobs.flatMap(job => {
    const health = jobHealth(job, states.get(job.name), nowMs, floor);
    if (health === 'late') {
      return [`${job.name}: spóźnione`];
    }
    if (health === 'failing') {
      return [`${job.name}: kolejne błędy`];
    }
    if (health === 'never_run') {
      return [`${job.name}: jeszcze nie uruchomione`];
    }
    return [];
  });
  const second = detectSecondInstance({
    states,
    ownInstance: state.instance,
    ownBootMs: state.bootMs,
  });
  if (second !== null) {
    problems.push('druga instancja backendu wykonuje zadania');
  }
  return {
    name: SCHEDULER_SERVICE_NAME,
    status: problems.length > 0 ? 'degraded' : 'healthy',
    latency_ms: latencyMs,
    message: problems.length > 0 ? problems.join('; ') : null,
  };
};

export const readJobStates = async (store: JobLeaseStore): Promise<JobStates> =>
  toJobStates(await store.readAll());
