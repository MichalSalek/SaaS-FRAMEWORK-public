import type { EventLogRecord } from '@kernel/models/db_models.manual.dto';
import { DB_CLIENT } from '@app/db/db.client';
import {
  markLogSinkWriteFailed,
  markLogSinkWriteSucceeded,
} from './log-sink-health';
import { ENV_VARS } from '@app/environment/environment.config';
import {
  getEnvironmentMode,
  IS_DEVELOPMENT_ENV,
} from '@app/environment/environment.utils.api';

// ---------------------------------------------------------------------------
// Log buffer — batches individual log entries into createMany calls.
// Intentionally in-memory: log loss on a hard crash is an accepted trade-off.
// ---------------------------------------------------------------------------

type LogEntry = Omit<EventLogRecord, 'id' | 'created_at'>;

const FLUSH_INTERVAL_MS = 200;
const MAX_BUFFER_SIZE = 50;

// DECISION: a failed write goes BACK to the buffer instead of vanishing. The old `buffer.splice(0)`
// dropped the whole batch on error, losing logs exactly when they matter most (DB down); a prod
// exception was in PostHog but not in AppLogRecord because the flush failed and the batch was lost.
//
// Retention is BOUNDED (RETRY_BUFFER_LIMIT): during a long DB outage process memory must not grow
// without end, so the OLDEST entries are discarded and their count is REPORTED by a synthetic
// record once the DB returns; silent log loss was the original problem, so it is not replaced by
// another silent loss.
const RETRY_BUFFER_LIMIT = 500;

// After a failed flush we do not retry at once, otherwise every further log (buffer still above
// the threshold) would hammer a downed database in a loop.
const FLUSH_COOLDOWN_AFTER_FAILURE_MS = 5_000;

const buffer: LogEntry[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let flushInFlight: Promise<void> | null = null;
let nextAttemptAllowedAtMs = 0;
let droppedEntryCount = 0;

const buildDropNoticeEntry = (dropped: number): LogEntry => ({
  environment: getEnvironmentMode(),
  type: 'warn',
  namespace: 'LOG_BUFFER_OVERFLOW',
  message: `Odrzucono ${dropped} wpisów logu podczas niedostępności bazy logów (limit bufora ${RETRY_BUFFER_LIMIT}).`,
  payload: JSON.stringify({ dropped, limit: RETRY_BUFFER_LIMIT }),
  user_metadata: JSON.stringify({ callstack: [] }),
  client_url: 'system',
  application: 'backend',
  event_log_chain_id: '0',
  user_id: null,
});

/**
 * Trims the buffer to the limit and counts the dropped entries. The OLDEST go first: during a
 * long outage the fresher entries carry the current state of the incident.
 */
const trimToLimit = (): void => {
  if (buffer.length <= RETRY_BUFFER_LIMIT) {
    return;
  }
  const overflow = buffer.length - RETRY_BUFFER_LIMIT;
  buffer.splice(0, overflow);
  droppedEntryCount += overflow;
};

/** Puts a batch back at the front of the buffer, trimming to the limit. */
const requeue = (batch: LogEntry[]): void => {
  buffer.unshift(...batch);
  trimToLimit();
};

const runFlush = async (): Promise<void> => {
  if (buffer.length === 0) {
    return;
  }

  const batch = buffer.splice(0);

  // DECISION: the `try` scope ENDS AT THE WRITE. Bookkeeping after a successful `createMany` (the
  // liveness sensor, the dropped-entries notice) used to sit INSIDE the block, so any exception AFTER
  // the batch was persisted fell into `catch` and did two harms at once: it requeued a batch already
  // in the DB (duplicate rows) and raised `[LOG_SINK_DOWN]` about a store that had just answered
  // correctly. A false red is as costly as a false green here; the sensor must tell "cannot measure"
  // from "not working".
  let persisted = false;
  try {
    await DB_CLIENT.useAppLogs.appLogRecord.createMany({ data: batch });
    persisted = true;
  } catch (error) {
    // Writing a log must never take the app down: the batch returns to the buffer and waits for
    // the next timer tick.
    nextAttemptAllowedAtMs = Date.now() + FLUSH_COOLDOWN_AFTER_FAILURE_MS;
    requeue(batch);
    console.error(
      `[log-buffer] flush failed, ${buffer.length} entries retained (dropped so far: ${droppedEntryCount}):`,
      error
    );
    // This is the only place where a log-sink outage becomes visible at all.
    markLogSinkWriteFailed(error);
  }

  if (!persisted) {
    return;
  }

  nextAttemptAllowedAtMs = 0;
  // The log-sink liveness probe is pinned HERE because this is the only real DB write.
  // See the DECISION in `log-sink-health.ts`.
  markLogSinkWriteSucceeded();

  if (droppedEntryCount > 0) {
    const notice = buildDropNoticeEntry(droppedEntryCount);
    droppedEntryCount = 0;
    buffer.push(notice);
  }
};

/**
 * Flushes the log buffer. Concurrent calls (timer + size threshold + shutdown) share ONE
 * execution; otherwise two flushes could send diverging batches and double the database traffic
 * during an outage.
 */
export async function flushLogBuffer(): Promise<void> {
  if (flushInFlight) {
    return flushInFlight;
  }
  flushInFlight = runFlush().finally(() => {
    flushInFlight = null;
  });
  return flushInFlight;
}

const flushIfAllowed = (): void => {
  if (Date.now() < nextAttemptAllowedAtMs) {
    return;
  }
  void flushLogBuffer();
};

function ensureFlushTimer(): void {
  if (flushTimer !== null) {
    return;
  }

  flushTimer = setInterval(flushIfAllowed, FLUSH_INTERVAL_MS);

  // Allow the process to exit even if the timer is still running.
  if (typeof flushTimer === 'object' && 'unref' in flushTimer) {
    flushTimer.unref();
  }
}

// Best-effort flush on shutdown.
process.on('beforeExit', () => {
  void flushLogBuffer();
});

// ---------------------------------------------------------------------------
// Public API — unchanged signature
// ---------------------------------------------------------------------------

export const createEventLogRecord_IO = async (
  data: LogEntry
): Promise<void> => {
  if (IS_DEVELOPMENT_ENV() && !ENV_VARS.ENABLE_APP_LOGS_DB) {
    return;
  }

  buffer.push(data);
  // Hard ceiling on the write path too: during the cooldown after a failed flush nothing drains
  // the buffer, so an error storm with the database down would grow it without bound.
  trimToLimit();
  ensureFlushTimer();

  if (buffer.length >= MAX_BUFFER_SIZE) {
    flushIfAllowed();
  }
};

/** Test-only: clears the buffer and the retry state between cases. */
export const __resetLogBufferForTests = (): void => {
  buffer.length = 0;
  droppedEntryCount = 0;
  nextAttemptAllowedAtMs = 0;
  flushInFlight = null;
  if (flushTimer !== null) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
};
