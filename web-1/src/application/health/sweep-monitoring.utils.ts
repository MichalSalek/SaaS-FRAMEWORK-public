/**
 * Sweep Monitoring — In-Memory Tracker
 *
 * Tracks last execution timestamp + duration + error for each request-interceptor
 * sweep. Exposed via admin /health endpoint as `sweeps` array.
 *
 * All state is per-instance (in-memory). Multi-instance setups: each pod tracks
 * its own sweep runs independently — admin /health shows the pod that served
 * the health request. This is acceptable because all pods share the same DB and
 * sweeps are idempotent (EventLog dedup prevents duplicate emails/cleanups).
 *
 * STALE threshold: 48h — if no sweep run was recorded, admin sees STALE + alert.
 * Uptime checks are deliberately DB-free and are NOT a sweep traffic floor, so
 * STALE means either no accepted application traffic or a maintenance failure.
 */

import type { SweepInfo, SweepStatus } from '@kernel/models/admin/admin.dto';
import { TIME } from '@kernel/application/constants.config';

/**
 * All sweep names — canonical SSOT array. `SweepName` is derived from it, so
 * adding a sweep HERE is the single required change: the union widens and
 * getSweepStatuses() automatically reports the new sweep (TS enforces sync).
 */
const ALL_SWEEP_NAMES = [
  'email-lifecycle',
  'event-log-cleanup',
  'ai-crawler-cleanup',
  'newsletter-pending-cleanup',
  'impersonation-backup-cleanup',
  'pairing-cleanup',
  'session-container-expiry',
  'recovery-expiry',
  'feature-flag-expiry',
  'stripe-event-janitor',
  'stripe-cancel-reconcile',
  'exchange-code-cleanup',
  'expired-session-cleanup',
] as const;

export type SweepName = (typeof ALL_SWEEP_NAMES)[number];

type SweepRecord = {
  lastRunAt: Date;
  lastDurationMs: number;
  lastError: string | undefined;
};

/** In-memory state — Map<SweepName, SweepRecord> */
const _sweepMap = new Map<SweepName, SweepRecord>();

/** STALE threshold: 48h (alert if no sweep in this window) */
const STALE_THRESHOLD_HOURS = 48;
const STALE_THRESHOLD_MS = STALE_THRESHOLD_HOURS * TIME.MS_PER_HOUR;

/**
 * Record a sweep run. Called after the sweep body executes.
 *
 * @param name - Canonical sweep name (SweepName union)
 * @param durationMs - Elapsed time in ms
 * @param error - Optional error string if sweep failed (still record run timestamp)
 */
export const recordSweepRun = (
  name: SweepName,
  durationMs: number,
  error?: string
): void => {
  _sweepMap.set(name, {
    lastRunAt: new Date(),
    lastDurationMs: durationMs,
    lastError: error,
  });
};

/**
 * Run a sweep function and automatically record timing + error to sweep monitoring.
 * Catches errors, records them as lastError, and re-throws so caller can handle.
 *
 * Usage: `await withSweepTiming('email-lifecycle', runSweep)`
 */
export const withSweepTiming = async (
  name: SweepName,
  fn: () => Promise<void>
): Promise<void> => {
  const start = performance.now();
  let sweepError: string | undefined;
  try {
    await fn();
  } catch (error) {
    sweepError = error instanceof Error ? error.message : String(error);
    throw error; // re-throw so caller's catch handles it
  } finally {
    recordSweepRun(name, Math.round(performance.now() - start), sweepError);
  }
};

/**
 * Return sweep statuses for all known sweeps.
 * Sweeps not yet run appear with status 'never_run'.
 */
export const getSweepStatuses = (): SweepInfo[] => {
  const now = Date.now();

  return ALL_SWEEP_NAMES.map(name => {
    const record = _sweepMap.get(name);

    if (!record) {
      return {
        name,
        status: 'never_run' as SweepStatus,
        last_run_at: null,
        last_duration_ms: null,
        last_error: null,
        stale_threshold_hours: STALE_THRESHOLD_HOURS,
      };
    }

    const ageMs = now - record.lastRunAt.getTime();
    const status: SweepStatus = ageMs > STALE_THRESHOLD_MS ? 'stale' : 'ok';

    return {
      name,
      status,
      last_run_at: record.lastRunAt.toISOString(),
      last_duration_ms: record.lastDurationMs,
      last_error: record.lastError ?? null,
      stale_threshold_hours: STALE_THRESHOLD_HOURS,
    };
  });
};
