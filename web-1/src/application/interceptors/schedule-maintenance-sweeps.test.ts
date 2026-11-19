import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  observePrimaryDatabaseRelease,
  resetPrimaryDatabaseAvailabilityForTests,
} from '@app/db/db-availability.state';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { appScheduler } from '@app/scheduler/scheduler.instance';
import { scheduleMaintenanceSweeps } from './schedule-maintenance-sweeps';

vi.mock('@app/runtime/run-after-response', () => ({
  runAfterResponse: vi.fn(),
}));

vi.mock('@app/scheduler/scheduler.instance', () => ({
  appScheduler: {
    runRound: vi.fn().mockResolvedValue(null),
    decideTick: vi.fn(),
  },
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

  it('starts one traffic round of the scheduler after a completed primary pool use', async () => {
    observePrimaryDatabaseRelease();
    scheduleMaintenanceSweeps(0);

    expect(runAfterResponse).toHaveBeenCalledTimes(1);
    const task = vi.mocked(runAfterResponse).mock.calls[0]?.[0];
    await task?.();
    expect(appScheduler.runRound).toHaveBeenCalledWith('traffic');
  });
});
