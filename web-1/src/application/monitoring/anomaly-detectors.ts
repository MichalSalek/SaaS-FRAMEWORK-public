/**
 * Anomaly Detectors — PURE decision logic (zero I/O).
 *
 * Extracted from anomaly-alerts.operation.ts (BDX W4.3) for testability: each
 * detector is a deterministic function of already-fetched counts/rows + thresholds,
 * returning whether an alert should fire and the data the orchestrator needs to
 * build the alert payload. NO DB, NO email, NO event-log, NO clock reads beyond
 * the values passed in — every detector is a unit candidate (vitest).
 *
 * The orchestrator (anomaly-alerts.operation.ts) owns ALL side effects: it queries
 * EventLog, calls these detectors, and on `triggered === true` sends the alert,
 * records the audit sentinel, and reports the issue.
 *
 * Thresholds live here as the single source of truth (orchestrator imports them
 * for payload labels), so detector + payload never drift.
 */

import { TIME } from '@kernel/application/constants.config';

const MS_PER_DAY = TIME.MS_PER_DAY;
const MS_PER_7_DAYS = 7 * MS_PER_DAY;

// ── Pairing anomaly ────────────────────────────────────────────────────────────

/** Pairing anomaly thresholds (SSOT for detector + payload labels). */
export const PAIRING_SPIKE_MULTIPLIER = 3;
export const PAIRING_DROP_MULTIPLIER = 0.3;

export type PairingAnomalyType = 'SPIKE' | 'DROP';

export type PairingAnomalyResult =
  | { triggered: false }
  | {
      triggered: true;
      anomalyType: PairingAnomalyType;
      todayCount: number;
      /** 6-day daily average (week count excluding today, divided by 6). */
      avgPerDay: number;
      /** todayCount / avgPerDay, 2dp string, or 'N/A' when no history. */
      ratio: string;
    };

/**
 * Decide whether today's pairing volume is anomalous vs the prior 6-day average.
 *
 * @param todayCount  pairing events in the last 24h
 * @param weekCount   pairing events in the prior 6-day window (7d ago → 1d ago)
 *
 * Spike if today > 3x average; drop if today < 0.3x average. No history
 * (avg === 0 && today === 0) → not triggered (avoids false positives on fresh
 * deployments). avg === 0 with today > 0 is NOT a spike here (no baseline to
 * multiply) — matches the original `avgPerDay > 0` guards.
 */
export const detectPairingAnomaly = (
  todayCount: number,
  weekCount: number
): PairingAnomalyResult => {
  // 6-day average (excluding today)
  const avgPerDay = weekCount / 6;

  // Skip if no historical data (avoid false positives on new deployments)
  if (avgPerDay === 0 && todayCount === 0) {
    return { triggered: false };
  }

  const isSpike =
    avgPerDay > 0 && todayCount > avgPerDay * PAIRING_SPIKE_MULTIPLIER;
  const isDrop =
    avgPerDay > 0 && todayCount < avgPerDay * PAIRING_DROP_MULTIPLIER;

  if (!isSpike && !isDrop) {
    return { triggered: false };
  }

  const ratio = avgPerDay > 0 ? (todayCount / avgPerDay).toFixed(2) : 'N/A';
  const anomalyType: PairingAnomalyType = isSpike ? 'SPIKE' : 'DROP';

  return { triggered: true, anomalyType, todayCount, avgPerDay, ratio };
};

// ── Upload error rate ────────────────────────────────────────────────────────────

/** Upload error-rate thresholds (SSOT for detector + payload labels). */
export const UPLOAD_ERROR_RATE_THRESHOLD = 0.05; // 5%
export const UPLOAD_MIN_VOLUME = 10;

export type UploadErrorRateResult =
  | { triggered: false }
  | {
      triggered: true;
      errorCount: number;
      successCount: number;
      totalCount: number;
      /** errorCount / totalCount, 1dp percent string (no '%'). */
      ratePct: string;
    };

/**
 * Decide whether the upload error rate is anomalous.
 *
 * Alerts when error rate > 5% AND total volume > MIN (avoid false positives on
 * tiny samples). Low volume (total < MIN) → not triggered.
 */
export const detectUploadErrorRate = (
  successCount: number,
  errorCount: number
): UploadErrorRateResult => {
  const totalCount = successCount + errorCount;

  // Skip if low volume (avoid false positives)
  if (totalCount < UPLOAD_MIN_VOLUME) {
    return { triggered: false };
  }

  const errorRate = errorCount / totalCount;

  if (errorRate <= UPLOAD_ERROR_RATE_THRESHOLD) {
    return { triggered: false };
  }

  const ratePct = (errorRate * 100).toFixed(1);

  return { triggered: true, errorCount, successCount, totalCount, ratePct };
};

// ── Impersonation volume (R-IMP1) ────────────────────────────────────────────────

/** ≥5 become-user actions in 1h per admin = anomaly. */
export const IMPERSONATION_VOLUME_THRESHOLD = 5;

export type TriggeredAdmin = { adminId: string; count: number };

export type ImpersonationVolumeResult =
  { triggered: false } | { triggered: true; triggeredAdmins: TriggeredAdmin[] };

/**
 * Decide whether any admin hit the impersonation-volume threshold in the window.
 *
 * @param adminIds  created_by_user_id for each become-user event in the last 1h
 *
 * Groups by admin id and flags any admin with >= threshold impersonations.
 * Empty input → not triggered.
 */
export const detectImpersonationVolume = (
  adminIds: readonly string[]
): ImpersonationVolumeResult => {
  if (adminIds.length === 0) {
    return { triggered: false };
  }

  const countByAdmin = new Map<string, number>();
  for (const adminId of adminIds) {
    countByAdmin.set(adminId, (countByAdmin.get(adminId) ?? 0) + 1);
  }

  const triggeredAdmins: TriggeredAdmin[] = [];
  for (const [adminId, count] of countByAdmin) {
    if (count >= IMPERSONATION_VOLUME_THRESHOLD) {
      triggeredAdmins.push({ adminId, count });
    }
  }

  if (triggeredAdmins.length === 0) {
    return { triggered: false };
  }

  return { triggered: true, triggeredAdmins };
};

// ── Impersonation off-hours (R-IMP2) ──────────────────────────────────────────────

export type ImpersonationOffHoursResult =
  { triggered: false } | { triggered: true; count: number; adminIds: string[] };

/**
 * Decide whether off-hours impersonation activity should alert.
 *
 * Off-hours window: 22:00-06:00 UTC (utcHour >= 22 || utcHour < 6). Outside the
 * window → not triggered (the orchestrator skips the query entirely). Inside the
 * window with zero rows → not triggered. Otherwise alerts with the count and the
 * distinct admin ids involved.
 *
 * @param utcHour  current UTC hour (0-23)
 * @param adminIds created_by_user_id for each become-user event in the last 1h
 */
export const isOffHoursUtc = (utcHour: number): boolean =>
  utcHour >= 22 || utcHour < 6;

export const detectImpersonationOffHours = (
  utcHour: number,
  adminIds: readonly string[]
): ImpersonationOffHoursResult => {
  if (!isOffHoursUtc(utcHour) || adminIds.length === 0) {
    return { triggered: false };
  }

  return {
    triggered: true,
    count: adminIds.length,
    adminIds: [...new Set(adminIds)],
  };
};

// ── Window helpers (re-exported for orchestrator query windows) ───────────────────

export { MS_PER_DAY, MS_PER_7_DAYS };
