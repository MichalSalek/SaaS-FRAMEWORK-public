import type {
  ServiceHealthCheck,
  SweepInfo,
} from '@kernel/models/admin/admin.dto';
import { prismaJobLeaseStore } from './job-lease.prisma';
import { SCHEDULED_JOBS } from './scheduled-jobs.registry';
import { getSchedulerState } from './scheduler.instance';
import {
  readJobStates,
  SCHEDULER_SERVICE_NAME,
  toSchedulerServiceHealth,
  toSweepInfos,
} from './scheduler-health';

/** Health-snapshot probe: one indexed read of `JobLease` (about 15 rows). */
export const checkSchedulerHealth = async (): Promise<ServiceHealthCheck> => {
  const startedAt = performance.now();
  try {
    const states = await readJobStates(prismaJobLeaseStore);
    return toSchedulerServiceHealth({
      jobs: SCHEDULED_JOBS,
      states,
      nowMs: Date.now(),
      state: getSchedulerState(),
      latencyMs: Math.round(performance.now() - startedAt),
    });
  } catch (error) {
    return {
      name: SCHEDULER_SERVICE_NAME,
      status: 'down',
      latency_ms: null,
      message: error instanceof Error ? error.message : 'Check failed',
    };
  }
};

/** ADMIN_HEALTH `sweeps` from the durable job table. */
export const getDurableSweepStatuses = async (): Promise<SweepInfo[]> =>
  toSweepInfos(
    SCHEDULED_JOBS,
    await readJobStates(prismaJobLeaseStore),
    Date.now()
  );
