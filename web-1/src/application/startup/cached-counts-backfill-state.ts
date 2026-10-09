import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { TIME } from '@kernel/application/constants.config';

// DECISION (nie usuwaj tego komentarza):
// In-memory throttle = fast-path. Resetuje sie na cold start (każdy nowy boot
// instancji = potencjalny run), DB advisory lock dedup'uje konkurujace instancje.
// Pattern 1:1 z pairing-cleanup-state. Dzieki temu backfill samoczynnie odpala
// sie po kazdym deploy (cold start), ale nigdy 2x rownolegle w klastrze.
//
// NIE jest to request-sweep (createSweepInterceptor W4.1) — to STARTUP backfill
// (instrumentation.ts), jednorazowy per deploy, dlatego zostaje poza fabryką.
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
