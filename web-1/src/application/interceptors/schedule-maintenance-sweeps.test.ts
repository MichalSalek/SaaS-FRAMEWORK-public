import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  observePrimaryDatabaseRelease,
  resetPrimaryDatabaseAvailabilityForTests,
} from '@app/db/db-availability.state';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { scheduleMaintenanceSweeps } from './schedule-maintenance-sweeps';

vi.mock('@app/runtime/run-after-response', () => ({
  runAfterResponse: vi.fn(),
}));

vi.mock('./domain-interceptors', () => ({
  aiCrawlerCleanupInterceptor: vi.fn(),
  emailLifecycleInterceptor: vi.fn(),
  eventLogCleanupInterceptor: vi.fn(),
  exchangeCodeCleanupInterceptor: vi.fn(),
  expiredSessionCleanupInterceptor: vi.fn(),
  featureFlagExpiryInterceptor: vi.fn(),
  impersonationBackupCleanupInterceptor: vi.fn(),
  newsletterPendingCleanupInterceptor: vi.fn(),
  pairingCleanupInterceptor: vi.fn(),
  recoveryExpiryInterceptor: vi.fn(),
  sessionContainerExpiryInterceptor: vi.fn(),
  stripeCancelReconcileInterceptor: vi.fn(),
  stripeEventJanitorInterceptor: vi.fn(),
}));

describe('scheduleMaintenanceSweeps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPrimaryDatabaseAvailabilityForTests();
  });

  it('does not turn accepted non-DB traffic into a database keepalive', () => {
    scheduleMaintenanceSweeps(0);

    expect(runAfterResponse).not.toHaveBeenCalled();
  });

  it('schedules all lazy sweeps after a completed primary pool use', () => {
    observePrimaryDatabaseRelease();
    scheduleMaintenanceSweeps(0);

    expect(runAfterResponse).toHaveBeenCalledTimes(13);
  });
});
