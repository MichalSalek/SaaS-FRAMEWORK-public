import { isDatabaseConnectivityError } from './prisma-error';

export type DatabaseAvailability = 'unknown' | 'up' | 'down';

export type DatabaseAvailabilitySnapshot = Readonly<{
  status: DatabaseAvailability;
  changedAt: string;
  lastSuccessfulUseAt: string | null;
  successfulUseCount: number;
}>;

type MutableAvailabilityState = {
  availability: DatabaseAvailability;
  changedAt: string;
  lastSuccessfulUseAt: string | null;
  successfulUseCount: number;
};

const globalScope = globalThis as typeof globalThis & {
  __primaryDbAvailabilityState?: MutableAvailabilityState;
};

const state: MutableAvailabilityState =
  (globalScope.__primaryDbAvailabilityState ??= {
    availability: 'unknown',
    changedAt: new Date().toISOString(),
    lastSuccessfulUseAt: null,
    successfulUseCount: 0,
  });

/**
 * Passive primary-DB availability state.
 *
 * DECISION: Better Stack must not probe Postgres, because a three-minute `SELECT 1` keeps Neon
 * compute permanently active. The API process therefore exposes its last observed state:
 * a pool release without a connectivity failure means UP, only a structurally classified
 * connectivity failure means DOWN, and query/constraint errors prove the server answered so they do
 * not flip availability. With multiple replicas this would need a per-replica monitor or shared
 * delivery; production runs one instance.
 */
export const markPrimaryDatabaseUp = (): void => {
  const observedAt = new Date().toISOString();
  state.successfulUseCount += 1;
  state.lastSuccessfulUseAt = observedAt;
  if (state.availability !== 'up') {
    state.availability = 'up';
    state.changedAt = observedAt;
  }
};

export const observePrimaryDatabaseError = (error: unknown): void => {
  if (!isDatabaseConnectivityError(error) || state.availability === 'down') {
    return;
  }
  state.availability = 'down';
  state.changedAt = new Date().toISOString();
};

/** Central pg.Pool release observer for both successful and failed queries. */
export const observePrimaryDatabaseRelease = (error?: unknown): void => {
  if (isDatabaseConnectivityError(error)) {
    observePrimaryDatabaseError(error);
    return;
  }
  // A successful statement or a server-side query/constraint error proves that
  // the primary database accepted the connection and responded.
  markPrimaryDatabaseUp();
};

export const getPrimaryDatabaseAvailability =
  (): DatabaseAvailabilitySnapshot => ({
    status: state.availability,
    changedAt: state.changedAt,
    lastSuccessfulUseAt: state.lastSuccessfulUseAt,
    successfulUseCount: state.successfulUseCount,
  });

export const resetPrimaryDatabaseAvailabilityForTests = (): void => {
  state.availability = 'unknown';
  state.changedAt = new Date().toISOString();
  state.lastSuccessfulUseAt = null;
  state.successfulUseCount = 0;
};
