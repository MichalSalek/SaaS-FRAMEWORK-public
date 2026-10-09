import { runAfterResponse } from '@app/runtime/run-after-response';
import { getPrimaryDatabaseAvailability } from '@app/db/db-availability.state';
import {
  aiCrawlerCleanupInterceptor,
  emailLifecycleInterceptor,
  eventLogCleanupInterceptor,
  exchangeCodeCleanupInterceptor,
  expiredSessionCleanupInterceptor,
  featureFlagExpiryInterceptor,
  impersonationBackupCleanupInterceptor,
  newsletterPendingCleanupInterceptor,
  pairingCleanupInterceptor,
  recoveryExpiryInterceptor,
  sessionContainerExpiryInterceptor,
  stripeCancelReconcileInterceptor,
  stripeEventJanitorInterceptor,
} from './domain-interceptors';

/**
 * Every lazy maintenance sweep, each behind its own throttle, run after the
 * response. Shared by the traffic path above and the external tick
 * (pages/api/v1/internal/sweep-tick), so both start exactly the same set.
 */
export const runMaintenanceSweeps = (): void => {
  runAfterResponse(() => pairingCleanupInterceptor());
  runAfterResponse(() => sessionContainerExpiryInterceptor());
  runAfterResponse(() => emailLifecycleInterceptor());
  runAfterResponse(() => eventLogCleanupInterceptor());
  runAfterResponse(() => aiCrawlerCleanupInterceptor());
  runAfterResponse(() => newsletterPendingCleanupInterceptor());
  runAfterResponse(() => impersonationBackupCleanupInterceptor());
  runAfterResponse(() => stripeEventJanitorInterceptor());
  runAfterResponse(() => stripeCancelReconcileInterceptor());
  runAfterResponse(() => recoveryExpiryInterceptor());
  runAfterResponse(() => featureFlagExpiryInterceptor());
  runAfterResponse(() => exchangeCodeCleanupInterceptor());
  runAfterResponse(() => expiredSessionCleanupInterceptor());
};

/**
 * Schedule lazy maintenance only after an accepted CQRS request completed its
 * business logic. At that point real application traffic has already justified
 * waking the database. Health checks, invalid traffic and rejected auth/method
 * requests can no longer trigger thirteen background DB sweeps.
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

  runMaintenanceSweeps();
};
