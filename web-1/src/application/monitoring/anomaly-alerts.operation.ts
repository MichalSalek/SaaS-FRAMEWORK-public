// DECISION (nie usuwaj tego komentarza):
// Sweep odpalany przez request interceptor (NIE external cron). Świadoma decyzja
// Korekta 2026-07-19: uptime monitor jest DB-free i NIE jest traffic floorem.
// Sweep planuje się dopiero po zaakceptowanym ruchu aplikacji, gdy DB już była potrzebna.
// Monitoring: "last sweep at" w admin /health; >48h = sygnał do oceny external crona.
// NOTE: Anomaly checks run INSIDE email-lifecycle sweep (step 7), not as standalone interceptor.
// Timing tracked as part of email-lifecycle sweep in sweep-monitoring.utils.ts.

/**
 * Anomaly Alerts — Pairing Spike/Drop + Upload Error Rate + Impersonation Anomalies
 *
 * Runs as part of email lifecycle sweep (fire-and-forget).
 * Queries EventLog for anomalies, sends admin alerts via sendCriticalBusinessAlert().
 * Dedup via EventLog — max 1 alert per type per day.
 *
 * Pattern: follows admin-alerts.operation.ts (sendDailySignupDigest_IO)
 *
 * Split (BDX W4.3): this file is the THIN I/O orchestrator — it queries EventLog,
 * delegates the anomaly decision to the PURE detectors in anomaly-detectors.ts, and
 * on a triggered result performs the side effects (send alert, record audit sentinel,
 * report issue). The decision logic itself has zero I/O and is unit-tested directly
 * (anomaly-detectors.test.ts).
 */

import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { EventLogTypeValue } from '@kernel/models/db_models.generated.dto';
import { TIME } from '@kernel/application/constants.config';
import { DB_CLIENT } from '@app/db/db.client';
import { sendCriticalBusinessAlert } from '@app/email-handler/email.operations';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { resolveSystemActorId_IO } from '@app/event-log/system-actor';
import { reportIssueBackend } from '@app/debugger/error-handler';
import {
  detectPairingAnomaly,
  detectUploadErrorRate,
  detectImpersonationVolume,
  detectImpersonationOffHours,
  isOffHoursUtc,
  PAIRING_SPIKE_MULTIPLIER,
  PAIRING_DROP_MULTIPLIER,
  UPLOAD_ERROR_RATE_THRESHOLD,
  UPLOAD_MIN_VOLUME,
  IMPERSONATION_VOLUME_THRESHOLD,
  MS_PER_DAY,
  MS_PER_7_DAYS,
} from '@app/monitoring/anomaly-detectors';

const MS_PER_HOUR = TIME.MS_PER_HOUR;

/** Pairing events tracked in DOMAIN event_type */
const PAIRING_EVENTS = [
  APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_ISSUED,
  APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_CLAIMED,
  APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_REVOKED,
  APP_EVENTS.INFO.PAIRING.PAIRING_ACCESS_REVOKED,
] as const;

/** Dedup helper: true if the given alert sentinel was already written in the last 24h. */
const wasAlertSentToday_IO = async (
  event: (typeof APP_EVENTS.INFO.EMAIL)[keyof typeof APP_EVENTS.INFO.EMAIL],
  oneDayAgo: Date
): Promise<boolean> => {
  const existingAlert = await DB_CLIENT.use.eventLog.findFirst({
    where: {
      event,
      event_type: EventLogTypeValue.EMAIL,
      created_at: { gte: oneDayAgo },
    },
    select: { event_log_id: true },
  });
  return existingAlert !== null;
};

/**
 * Check for pairing volume anomalies.
 *
 * Compares today's pairing event count (last 24h) against the 7-day average.
 * Alerts if today > 3x average (spike) or today < 0.3x average (drop).
 */
const checkPairingAnomaly_IO = async (systemActorId: string): Promise<void> => {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - MS_PER_DAY);
  const sevenDaysAgo = new Date(now.getTime() - MS_PER_7_DAYS);

  // Dedup: max 1 alert per type per day
  if (
    await wasAlertSentToday_IO(
      APP_EVENTS.INFO.EMAIL.ALERT_PAIRING_ANOMALY_SENT,
      oneDayAgo
    )
  ) {
    return;
  }

  // Count pairing events in the last 24h and last 7 days in parallel
  const [todayCount, weekCount] = await Promise.all([
    DB_CLIENT.use.eventLog.count({
      where: {
        event: { in: [...PAIRING_EVENTS] },
        event_type: EventLogTypeValue.DOMAIN,
        created_at: { gte: oneDayAgo },
      },
    }),
    DB_CLIENT.use.eventLog.count({
      where: {
        event: { in: [...PAIRING_EVENTS] },
        event_type: EventLogTypeValue.DOMAIN,
        created_at: { gte: sevenDaysAgo, lt: oneDayAgo },
      },
    }),
  ]);

  const result = detectPairingAnomaly(todayCount, weekCount);
  if (!result.triggered) {
    return;
  }

  const { anomalyType, avgPerDay, ratio } = result;

  await sendCriticalBusinessAlert({
    alertTitle: 'Nietypowa liczba połączeń z klientkami',
    alertMessage: `Połączeń ${anomalyType === 'SPIKE' ? 'wyraźnie więcej' : 'wyraźnie mniej'} niż zwykle: dziś ${result.todayCount}, średnio ${avgPerDay.toFixed(1)} dziennie (${ratio}x).`,
    details: {
      anomalyType,
      todayCount: result.todayCount,
      avg7d: Number(avgPerDay.toFixed(1)),
      ratio,
      threshold:
        anomalyType === 'SPIKE'
          ? `>${PAIRING_SPIKE_MULTIPLIER}x average`
          : `<${PAIRING_DROP_MULTIPLIER}x average`,
      period: `${oneDayAgo.toISOString()} — ${now.toISOString()}`,
    },
  });

  await recordAuditEvent_IO({
    eventName: APP_EVENTS.INFO.EMAIL.ALERT_PAIRING_ANOMALY_SENT,
    user: { id: systemActorId },
    responseBody: {
      anomalyType,
      todayCount: result.todayCount,
      avg7d: Number(avgPerDay.toFixed(1)),
      ratio,
    },
  });

  reportIssueBackend({
    namespace: 'ANOMALY_ALERT',
    message: `Pairing ${anomalyType} alert sent: ${result.todayCount} today vs ${avgPerDay.toFixed(1)} avg`,
    payload: { anomalyType, todayCount: result.todayCount, avgPerDay, ratio },
    mode: 'warn',
  });
};

/**
 * Check for upload error rate anomalies.
 *
 * Counts successful gallery record creations vs failures in the last 24h.
 * Alerts if error rate > 5% AND total volume > 10 (avoid false positives).
 */
const checkUploadErrorRate_IO = async (
  systemActorId: string
): Promise<void> => {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - MS_PER_DAY);

  // Dedup: max 1 alert per type per day
  if (
    await wasAlertSentToday_IO(
      APP_EVENTS.INFO.EMAIL.ALERT_UPLOAD_ERROR_RATE_SENT,
      oneDayAgo
    )
  ) {
    return;
  }

  // Count successful uploads (gallery record created = upload success) and errors
  const [successCount, errorCount] = await Promise.all([
    DB_CLIENT.use.eventLog.count({
      where: {
        event: APP_EVENTS.INFO.GALLERY.GALLERY_RECORD_CREATED,
        event_type: EventLogTypeValue.GALLERY,
        created_at: { gte: oneDayAgo },
      },
    }),
    DB_CLIENT.use.eventLog.count({
      where: {
        event: APP_EVENTS.INFO.GALLERY.CANNOT_CREATE_GALLERY_RECORD,
        event_type: EventLogTypeValue.GALLERY,
        created_at: { gte: oneDayAgo },
      },
    }),
  ]);

  const result = detectUploadErrorRate(successCount, errorCount);
  if (!result.triggered) {
    return;
  }

  const { ratePct, totalCount } = result;

  await sendCriticalBusinessAlert({
    alertTitle: 'Dużo błędów przy wgrywaniu zdjęć',
    alertMessage: `Błędy wgrywania: ${ratePct}% (${result.errorCount} z ${totalCount} prób w ostatniej dobie).`,
    details: {
      errorCount: result.errorCount,
      successCount: result.successCount,
      totalCount,
      errorRatePct: ratePct,
      threshold: `${(UPLOAD_ERROR_RATE_THRESHOLD * 100).toFixed(0)}%`,
      minVolume: UPLOAD_MIN_VOLUME,
      period: `${oneDayAgo.toISOString()} — ${now.toISOString()}`,
    },
  });

  await recordAuditEvent_IO({
    eventName: APP_EVENTS.INFO.EMAIL.ALERT_UPLOAD_ERROR_RATE_SENT,
    user: { id: systemActorId },
    responseBody: {
      errorCount: result.errorCount,
      totalCount,
      errorRatePct: ratePct,
    },
  });

  reportIssueBackend({
    namespace: 'ANOMALY_ALERT',
    message: `Upload error rate alert sent: ${ratePct}% (${result.errorCount}/${totalCount})`,
    payload: { errorCount: result.errorCount, totalCount, ratePct },
    mode: 'warn',
  });
};

/**
 * R-IMP1: "admin became 5+ users in 1h"
 *
 * Queries EventLog for ADMIN.USER_BECAME_SOMEONE_ELSE events in the last hour,
 * groups by admin (created_by_user_id), alerts if any admin hit ≥5 impersonations.
 * Pre-launch safety: catch compromised admin account or operational error early.
 *
 * DECISION (timezone):
 * Uses UTC timestamps via Date.now() — no CET timezone helper exists in codebase.
 * UTC is correct here: anomaly window is 1h regardless of timezone.
 */
const checkImpersonationVolume_IO = async (
  systemActorId: string
): Promise<void> => {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - MS_PER_HOUR);
  const oneDayAgo = new Date(now.getTime() - MS_PER_DAY);

  // Dedup: max 1 alert per type per day
  if (
    await wasAlertSentToday_IO(
      APP_EVENTS.INFO.EMAIL.ALERT_IMPERSONATION_VOLUME_SENT,
      oneDayAgo
    )
  ) {
    return;
  }

  // Count impersonation events in last 1h, grouped by admin (created_by_user_id)
  const recentImpersonations = await DB_CLIENT.use.eventLog.findMany({
    where: {
      event: APP_EVENTS.INFO.ADMIN.USER_BECAME_SOMEONE_ELSE,
      event_type: EventLogTypeValue.ADMIN,
      created_at: { gte: oneHourAgo },
    },
    select: {
      created_by_user_id: true,
    },
    take: 200, // Guard: 200 impersonations/h is far beyond any plausible threshold
  });

  const result = detectImpersonationVolume(
    recentImpersonations.map(r => r.created_by_user_id)
  );
  if (!result.triggered) {
    return;
  }

  const { triggeredAdmins } = result;

  await sendCriticalBusinessAlert({
    alertTitle: 'Nietypowo dużo wcieleń w innych użytkowników',
    alertMessage: `Admin wcielił się w co najmniej ${IMPERSONATION_VOLUME_THRESHOLD} kont w ciągu godziny. Możliwy incydent bezpieczeństwa albo błąd automatu.`,
    details: {
      rule: 'R-IMP1',
      threshold: `>=${IMPERSONATION_VOLUME_THRESHOLD} impersonations in 1h per admin`,
      triggeredAdmins,
      period: `${oneHourAgo.toISOString()} — ${now.toISOString()}`,
    },
  });

  await recordAuditEvent_IO({
    eventName: APP_EVENTS.INFO.EMAIL.ALERT_IMPERSONATION_VOLUME_SENT,
    user: { id: systemActorId },
    responseBody: {
      triggeredAdmins,
      threshold: IMPERSONATION_VOLUME_THRESHOLD,
    },
  });

  reportIssueBackend({
    namespace: 'ANOMALY_ALERT',
    message: `R-IMP1: Impersonation volume alert sent: ${triggeredAdmins.length} admin(s) exceeded ${IMPERSONATION_VOLUME_THRESHOLD} impersonations/h`,
    payload: { triggeredAdmins },
    mode: 'warn',
  });
};

/**
 * R-IMP2: "impersonation outside business hours"
 *
 * Alerts if any become-user action occurred between 22:00-06:00 UTC.
 * Off-hours window: hour >= 22 OR hour < 6 (UTC).
 *
 * DECISION (timezone):
 * Uses UTC hours. No CET timezone helper exists in codebase. UTC is conservative
 * (CET = UTC+1/+2, so UTC 22:00 = CET 23:00/00:00) — slightly later threshold
 * than strict CET business hours but avoids false positives from UTC conversion.
 * Re-evaluate if CET timezone helper is added post-launch.
 */
const checkImpersonationOffHours_IO = async (
  systemActorId: string
): Promise<void> => {
  const now = new Date();
  const utcHour = now.getUTCHours();

  // Only check if we're currently in off-hours window to avoid querying unnecessarily
  // Off-hours: 22:00-06:00 UTC
  if (!isOffHoursUtc(utcHour)) {
    return;
  }

  const oneDayAgo = new Date(now.getTime() - MS_PER_DAY);

  // Dedup: max 1 alert per type per day
  if (
    await wasAlertSentToday_IO(
      APP_EVENTS.INFO.EMAIL.ALERT_IMPERSONATION_OFF_HOURS_SENT,
      oneDayAgo
    )
  ) {
    return;
  }

  // Window: last 1h to catch recent off-hours activity
  const oneHourAgo = new Date(now.getTime() - MS_PER_HOUR);

  const offHoursImpersonations = await DB_CLIENT.use.eventLog.findMany({
    where: {
      event: APP_EVENTS.INFO.ADMIN.USER_BECAME_SOMEONE_ELSE,
      event_type: EventLogTypeValue.ADMIN,
      created_at: { gte: oneHourAgo },
    },
    // created_by_user_id is the only field used by the detector + payload
    select: {
      created_by_user_id: true,
    },
    // Cap the off-hours window scan: 50 impersonation events in one hour already
    // far exceeds any plausible legitimate off-hours admin rate (the detector only
    // needs the distinct-actor signal, not an exhaustive count).
    take: 50,
  });

  const result = detectImpersonationOffHours(
    utcHour,
    offHoursImpersonations.map(e => e.created_by_user_id)
  );
  if (!result.triggered) {
    return;
  }

  await sendCriticalBusinessAlert({
    alertTitle: 'Wcielanie się w użytkowników nocą',
    alertMessage: `Wcieleń między 22:00 a 6:00 UTC: ${result.count}. Obecna godzina UTC: ${utcHour}.`,
    details: {
      rule: 'R-IMP2',
      offHoursWindow: '22:00-06:00 UTC',
      currentUtcHour: utcHour,
      count: result.count,
      adminIds: result.adminIds,
      period: `${oneHourAgo.toISOString()} — ${now.toISOString()}`,
    },
  });

  await recordAuditEvent_IO({
    eventName: APP_EVENTS.INFO.EMAIL.ALERT_IMPERSONATION_OFF_HOURS_SENT,
    user: { id: systemActorId },
    responseBody: {
      count: result.count,
      utcHour,
    },
  });

  reportIssueBackend({
    namespace: 'ANOMALY_ALERT',
    message: `R-IMP2: Off-hours impersonation alert sent: ${result.count} action(s) at UTC hour ${utcHour}`,
    payload: { count: result.count, utcHour },
    mode: 'warn',
  });
};

/**
 * Run all anomaly checks (fire-and-forget, error-isolated).
 * Each check has its own EventLog dedup (max 1/day/type).
 */
export const runAnomalyChecks_IO = async (): Promise<void> => {
  // DECISION (nie usuwaj tego komentarza): system actor resolved ONCE, checks
  // SKIPPED when unavailable — the ALERT_*_SENT dedup sentinel is silently
  // dropped by writeRawEventLog_IO without created_by_user_id, so sending
  // anyway would defeat dedup and spam the admin on EVERY sweep. Loud report
  // instead of silent degradation (unseeded admin must be visible).
  const systemActorId = await resolveSystemActorId_IO();
  if (!systemActorId) {
    reportIssueBackend({
      namespace: 'ANOMALY_CHECK',
      message:
        'Anomaly checks SKIPPED: system actor unavailable (no admin user seeded/configured) — EventLog dedup sentinel cannot be persisted',
      payload: {},
      mode: 'error',
    });
    return;
  }

  const checks: ReadonlyArray<[string, (actorId: string) => Promise<void>]> = [
    ['Pairing anomaly', checkPairingAnomaly_IO],
    ['Upload error rate', checkUploadErrorRate_IO],
    ['Impersonation volume', checkImpersonationVolume_IO],
    ['Impersonation off-hours', checkImpersonationOffHours_IO],
  ];

  for (const [label, check] of checks) {
    try {
      await check(systemActorId);
    } catch (error) {
      reportIssueBackend({
        namespace: 'ANOMALY_CHECK',
        message: `${label} check failed (non-blocking)`,
        payload: error,
        mode: 'error',
      });
    }
  }
};
