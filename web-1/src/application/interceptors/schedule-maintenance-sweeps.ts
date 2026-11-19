import { runAfterResponse } from '@app/runtime/run-after-response';
import { getPrimaryDatabaseAvailability } from '@app/db/db-availability.state';
import { appScheduler } from '@app/scheduler/scheduler.instance';

/**
 * Secondary trigger of the job scheduler: after an accepted CQRS request that already used the
 * primary database, start a scheduler round after the response. The round claims through the same
 * durable lease as the external tick (internal/sweep-tick), so traffic and tick never double a run,
 * and it does not touch the database at all while process memory says nothing is due. Rationale:
 * DECISION in application/scheduler/scheduled-jobs.registry.ts.
 */
export const scheduleMaintenanceSweeps = (
  primaryUseCountAtRequestStart: number
): void => {
  // Public/auth-off handlers can complete useful work without Postgres. Do not
  // turn those requests into an accidental DB keepalive: only piggyback when a
  // completed primary-pool use was observed while this request was in flight.
  if (
    getPrimaryDatabaseAvailability().successfulUseCount <=
    primaryUseCountAtRequestStart
  ) {
    return;
  }

  runAfterResponse(() => appScheduler.runRound('traffic'));
};
