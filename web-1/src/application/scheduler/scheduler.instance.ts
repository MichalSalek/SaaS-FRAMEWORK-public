import { reportIssueBackend } from '@app/debugger/error-handler';
import { prismaJobLeaseStore } from './job-lease.prisma';
import { SCHEDULED_JOBS } from './scheduled-jobs.registry';
import {
  createScheduler,
  createSchedulerState,
  type Scheduler,
  type SchedulerState,
} from './scheduler';

// DECISION: the process memory of the scheduler lives on globalThis. Next bundles a module imported
// by both instrumentation and pages/api twice, and two copies of `running`/`states` would let the
// copies race each other inside one process (the lease would still hold, but rounds and reports would
// double). Everything durable is in `JobLease`; this is only a cache and an in-flight set.
const STATE_KEY = Symbol.for('nailfolio.scheduler.state');
type StateHolder = { [STATE_KEY]?: SchedulerState };

export const getSchedulerState = (): SchedulerState => {
  const holder = globalThis as StateHolder;
  const existing = holder[STATE_KEY];
  if (existing !== undefined) {
    return existing;
  }
  const created = createSchedulerState();
  holder[STATE_KEY] = created;
  return created;
};

export const appScheduler: Scheduler = createScheduler({
  jobs: SCHEDULED_JOBS,
  store: prismaJobLeaseStore,
  state: getSchedulerState(),
  report: reportIssueBackend,
});
