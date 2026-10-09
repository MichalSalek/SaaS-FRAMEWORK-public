import { beforeEach, describe, expect, it } from 'vitest';
import {
  getPrimaryDatabaseAvailability,
  markPrimaryDatabaseUp,
  observePrimaryDatabaseError,
  observePrimaryDatabaseRelease,
  resetPrimaryDatabaseAvailabilityForTests,
} from './db-availability.state';

describe('primary database passive availability state', () => {
  beforeEach(() => resetPrimaryDatabaseAvailabilityForTests());

  it('starts unknown, becomes up on pool acquire and down on connectivity error', () => {
    expect(getPrimaryDatabaseAvailability().status).toBe('unknown');

    markPrimaryDatabaseUp();
    expect(getPrimaryDatabaseAvailability()).toMatchObject({
      status: 'up',
      successfulUseCount: 1,
    });

    markPrimaryDatabaseUp();
    expect(getPrimaryDatabaseAvailability().successfulUseCount).toBe(2);

    observePrimaryDatabaseError({ cause: { kind: 'ConnectionClosed' } });
    expect(getPrimaryDatabaseAvailability().status).toBe('down');
  });

  it('recovers on the next successful pool acquire', () => {
    observePrimaryDatabaseError({ code: 'P1001' });
    markPrimaryDatabaseUp();

    const snapshot = getPrimaryDatabaseAvailability();
    expect(snapshot.status).toBe('up');
    expect(snapshot.lastSuccessfulUseAt).not.toBeNull();
  });

  it('ignores constraint and concurrency failures', () => {
    markPrimaryDatabaseUp();
    observePrimaryDatabaseError({ code: 'P2002' });
    observePrimaryDatabaseError({ originalCode: '40001' });

    expect(getPrimaryDatabaseAvailability().status).toBe('up');
  });

  it('observes pool releases centrally without treating query timeouts as outages', () => {
    observePrimaryDatabaseRelease({ code: 'P1008' });
    expect(getPrimaryDatabaseAvailability().status).toBe('up');

    observePrimaryDatabaseRelease({ code: 'P1001' });
    expect(getPrimaryDatabaseAvailability().status).toBe('down');
  });
});
