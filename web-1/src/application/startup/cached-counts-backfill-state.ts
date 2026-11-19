import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { TIME } from '@kernel/application/constants.config';

// DECISION: the in-memory throttle is a fast path that resets on cold start (every new boot is a
// potential run) while a DB advisory lock dedups competing instances (same pattern as
// pairing-cleanup-state), so the backfill self-runs after every deploy but never twice in
// parallel in a cluster. It is a STARTUP backfill (instrumentation.ts), not a request sweep, so
// it stays outside createSweepInterceptor.
let lastBackfillAttemptTimestamp = 0;

const BACKFILL_THROTTLE_MS = TIME.MS_PER_DAY;

// Advisory lock ID — distinct od pairing (7_808_117_001) i stripe janitor.
const CACHED_COUNTS_BACKFILL_LOCK_ID = 9_321_456_789;

export const shouldAttemptBackfill = (): boolean =>
  Date.now() - lastBackfillAttemptTimestamp > BACKFILL_THROTTLE_MS;

export const updateLastBackfillAttempt = (): void => {
  lastBackfillAttemptTimestamp = Date.now();
};

export const tryAcquireBackfillLock = async (): Promise<boolean> => {
  try {
    const result = await DB_CLIENT.use.$queryRaw<
      Array<{ locked: boolean }>
    >`SELECT pg_try_advisory_lock(${CACHED_COUNTS_BACKFILL_LOCK_ID}::bigint) AS locked`;
    return result[0]?.locked === true;
  } catch (error) {
    reportIssueBackend({
      namespace: 'cachedCountsBackfillLock',
      message: 'Failed to acquire advisory lock',
      payload: error,
      mode: 'error',
    });
    return false;
  }
};

export const releaseBackfillLock = async (): Promise<void> => {
  try {
    await DB_CLIENT.use
      .$queryRaw`SELECT pg_advisory_unlock(${CACHED_COUNTS_BACKFILL_LOCK_ID}::bigint)`;
  } catch (error) {
    reportIssueBackend({
      namespace: 'cachedCountsBackfillLock',
      message: 'Failed to release advisory lock',
      payload: error,
      mode: 'error',
    });
  }
};
