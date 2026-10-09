import { DB_CLIENT } from '@app/db/db.client';
import {
  checkCloudinaryEgress,
  getDatabaseP95Latency,
} from '@app/health/health-check.utils';
import { getCachedServiceHealthSnapshot } from '@app/health/service-health.snapshot';
import { getAverageResponseTime } from '@app/health/request-timing.buffer';
import { getSweepStatuses } from '@app/health/sweep-monitoring.utils';
import { getEnvironmentMode } from '@app/environment/environment.utils.api';
import { getEmailDeliverabilityInfo } from '@app/email-handler/email-circuit-breaker';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { TIME } from '@kernel/application/constants.config';
import type { OperationResult } from '@kernel/application/result.types';
import { success } from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { AdminInsufficientPermissionsError } from '@kernel/domain/admin/admin-errors.types';
import type {
  ADMIN_DTO_API_V1,
  LogAggregateRow,
  RecentError,
} from '@kernel/models/admin/admin.dto';
import type { GetCurrentUserOutputOptimistic } from '@domain/user/user.types';
import { requireAdminPermission } from '@domain/admin/admin.guards';
import { QUERY_LIMITS } from '@kernel/domain/admin/admin.config';
import { databaseFailure } from '@app/errors/error-result.helpers';

type HealthResponse = ADMIN_DTO_API_V1['ADMIN_HEALTH']['RESPONSE'];

/**
 * Get system health information for admin dashboard.
 * All external checks run in parallel via Promise.allSettled.
 * Error queries go to the app-logs DB (separate Neon instance).
 */
export const adminGetHealth_IO = async ({
  currentUser,
}: {
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<
  OperationResult<
    HealthResponse,
    AdminInsufficientPermissionsError | DatabaseError
  >
> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }
  try {
    // ── Backend info ──
    const memUsage = process.memoryUsage();
    const backend = {
      uptime_seconds: Math.round(process.uptime()),
      memory_usage_mb: Math.round(memUsage.heapUsed / 1024 / 1024),
      memory_total_mb: Math.round(memUsage.heapTotal / 1024 / 1024),
      node_version: process.version,
      environment: getEnvironmentMode(),
    };

    // ── Health checks (parallel) ──
    // Service probes go through the shared 60s snapshot (same one the
    // attention badges read). Egress and P95 stay on their own caches.
    const [snapshotResult, cloudinaryEgressResult, p95LatencyResult] =
      await Promise.allSettled([
        getCachedServiceHealthSnapshot(),
        checkCloudinaryEgress(),
        getDatabaseP95Latency(),
      ]);

    const snapshot =
      snapshotResult.status === 'fulfilled'
        ? snapshotResult.value
        : {
            database: {
              name: 'Database (main)',
              status: 'down' as const,
              latency_ms: null,
              message: 'Check failed',
            },
            event_log_db: {
              name: 'Event Log DB',
              status: 'down' as const,
              latency_ms: null,
              message: 'Check failed',
            },
            external_services: [],
          };

    const p95_query_latency_ms =
      p95LatencyResult.status === 'fulfilled' ? p95LatencyResult.value : null;
    const database = { ...snapshot.database, p95_query_latency_ms };
    const event_log_db = snapshot.event_log_db;
    const external_services = snapshot.external_services;

    const cloudinary_egress =
      cloudinaryEgressResult.status === 'fulfilled'
        ? cloudinaryEgressResult.value
        : {
            egress_used_gb: null,
            egress_limit_gb: null,
            egress_pct: null,
            egress_status: 'unknown' as const,
            fetched_at: null,
            message: 'Cloudinary egress check failed unexpectedly',
          };

    // ── Error queries (app-logs DB) ──
    // DECISION (nie usuwaj tego komentarza):
    // SOURCE FILTER application='backend' on every source-sensitive dashboard signal
    // (errors, email_stats, alert_history). SEND_LOG is anonymous (BASE_PERMISSIONS,
    // pre-auth client error reporting) and lets the caller pick an arbitrary
    // namespace/type, so without this filter a client could inject rows that
    // masquerade as server-generated ALERT/EMAIL/error signals and pollute ops.
    // adminSendLog_IO hardcodes application='frontend'; the ONLY writer of
    // application='backend' to AppLogs is reportIssueBackend → error-handler.ts
    // (createEventLogRecord_IO), which produces ALL real server alerts/email-audit/
    // error rows. Scoping these queries to 'backend' is therefore complete (catches
    // every genuine server signal) and exact (excludes only the public ingestion path).
    const BACKEND_ORIGIN = 'backend';
    const oneHourAgo = new Date(Date.now() - TIME.MS_PER_HOUR);

    const [errorCount, recentErrorsRaw] = await Promise.all([
      DB_CLIENT.useAppLogs.appLogRecord.count({
        where: {
          application: BACKEND_ORIGIN,
          type: 'error',
          created_at: { gte: oneHourAgo },
        },
      }),
      DB_CLIENT.useAppLogs.appLogRecord.findMany({
        where: { application: BACKEND_ORIGIN, type: 'error' },
        orderBy: { created_at: 'desc' },
        take: QUERY_LIMITS.RECENT_ITEMS,
        select: {
          id: true,
          namespace: true,
          created_at: true,
          payload: true,
        },
      }),
    ]);

    const recent: RecentError[] = recentErrorsRaw.map(e => {
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = e.payload ? JSON.parse(e.payload) : null;
      } catch {
        /* non-JSON payload */
      }
      return {
        event_log_id: String(e.id),
        event: e.namespace,
        created_at: e.created_at.toISOString(),
        event_payload: parsed,
      };
    });

    // ── Log aggregates (AppLogs DB, query-only — BDX W6.2) ──
    // DECISION (nie usuwaj tego komentarza):
    // Lightweight observability WITHOUT Redis / in-memory windows (CLAUDE.md: no Redis).
    // `groupBy(namespace, type)` over the last hour is a single LIMIT-ed read against the
    // existing AppLogs DB — no extra infra, no per-request accumulator. Source-scoped to
    // application='backend' (same rationale as the error queries above: SEND_LOG is an
    // anonymous public writer and must not pollute server-signal aggregates).
    // Dead-letter counts surface SILENT backlogs the operator would otherwise miss:
    //  - Stripe dead-letters live in AppLogs (namespace STRIPE_EVENT_JANITOR_DEAD_LETTER,
    //    written by the janitor via reportIssueBackend).
    //  - Email dead-letters live in the MAIN EventLog as the audit event
    //    EMAIL_DEAD_LETTERED (recordAuditEvent_IO → writeRawEventLog_IO) — queried below
    //    alongside disputes, consistent with payments.pending_disputes_count.
    const STRIPE_DEAD_LETTER_NS = 'STRIPE_EVENT_JANITOR_DEAD_LETTER';
    const [logGroupsRaw, stripeDeadLetteredCount, emailDeadLetteredCount] =
      await Promise.all([
        DB_CLIENT.useAppLogs.appLogRecord.groupBy({
          by: ['namespace', 'type'],
          where: {
            application: BACKEND_ORIGIN,
            created_at: { gte: oneHourAgo },
          },
          _count: { _all: true },
          orderBy: { _count: { namespace: 'desc' } },
          take: QUERY_LIMITS.LOG_AGGREGATE_GROUPS,
        }),
        DB_CLIENT.useAppLogs.appLogRecord.count({
          where: {
            application: BACKEND_ORIGIN,
            namespace: STRIPE_DEAD_LETTER_NS,
            created_at: { gte: oneHourAgo },
          },
        }),
        DB_CLIENT.use.eventLog.count({
          where: {
            event: APP_EVENTS.INFO.EMAIL.EMAIL_DEAD_LETTERED,
            created_at: { gte: oneHourAgo },
          },
        }),
      ]);

    const by_namespace_type: LogAggregateRow[] = logGroupsRaw.map(g => ({
      namespace: g.namespace,
      type: g.type,
      count: g._count._all,
    }));

    // ── Performance ──
    const performance = getAverageResponseTime();

    // ── Email delivery stats (from EventLog) ──
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 7);

    const [
      emailSentToday,
      emailSentWeek,
      emailFailedToday,
      deadLetterUnresolved,
      deadLetterOldest,
    ] = await Promise.all([
      DB_CLIENT.useAppLogs.appLogRecord.count({
        where: {
          application: BACKEND_ORIGIN,
          namespace: { startsWith: 'EMAIL' },
          type: 'info',
          created_at: { gte: todayStart },
        },
      }),
      DB_CLIENT.useAppLogs.appLogRecord.count({
        where: {
          application: BACKEND_ORIGIN,
          namespace: { startsWith: 'EMAIL' },
          type: 'info',
          created_at: { gte: weekStart },
        },
      }),
      DB_CLIENT.useAppLogs.appLogRecord.count({
        where: {
          application: BACKEND_ORIGIN,
          namespace: { startsWith: 'EMAIL' },
          type: 'error',
          created_at: { gte: todayStart },
        },
      }),
      // C-obs-44: failedEmail dead-letter (main DB) — unresolved rows are silent send
      // failures (both Mailgun+SMTP fell over: reset-hasla / magic-link / welcome never
      // arrived). The table was write-only; surfacing count + oldest age makes it
      // visible to ops on the health dashboard.
      DB_CLIENT.use.failedEmail.count({ where: { resolved_at: null } }),
      DB_CLIENT.use.failedEmail.findFirst({
        where: { resolved_at: null },
        orderBy: { created_at: 'asc' },
        select: { created_at: true },
      }),
    ]);

    // ── Alert history (last 10 anomaly alerts) ──
    const alertsRaw = await DB_CLIENT.useAppLogs.appLogRecord.findMany({
      where: {
        application: BACKEND_ORIGIN,
        namespace: { startsWith: 'ALERT' },
      },
      orderBy: { created_at: 'desc' },
      take: 10,
      select: { id: true, namespace: true, created_at: true, payload: true },
    });

    const alert_history = alertsRaw.map(a => {
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = a.payload ? JSON.parse(a.payload) : null;
      } catch {
        /* non-JSON */
      }
      return {
        id: String(a.id),
        event: a.namespace,
        created_at: a.created_at.toISOString(),
        payload: parsed,
      };
    });

    // ── Payment disputes (last 30 days, from main EventLog) ──
    // DECISION (nie usuwaj tego komentarza):
    // Disputes are stored in EventLog (main DB) via charge-dispute.handler.ts,
    // not in AppLogs (app-logs DB). Query must go to DB_CLIENT.use.eventLog.
    // 30d window aligns with Stripe's dispute rate calculation period.
    // Dual signal: EventLog count (persistent audit) + alert_history (ops snapshot).
    const thirtyDaysAgo = new Date(Date.now() - 30 * TIME.MS_PER_DAY);
    const [pendingDisputesCount, lastDisputeRaw] = await Promise.all([
      DB_CLIENT.use.eventLog.count({
        where: {
          event: APP_EVENTS.INFO.ACCOUNT.STRIPE_CHARGE_DISPUTE_CREATED,
          created_at: { gte: thirtyDaysAgo },
        },
      }),
      DB_CLIENT.use.eventLog.findFirst({
        where: {
          event: APP_EVENTS.INFO.ACCOUNT.STRIPE_CHARGE_DISPUTE_CREATED,
          created_at: { gte: thirtyDaysAgo },
        },
        orderBy: { created_at: 'desc' },
        select: { created_at: true },
      }),
    ]);

    const payments = {
      pending_disputes_count: pendingDisputesCount,
      last_dispute_at: lastDisputeRaw?.created_at.toISOString() ?? null,
    };

    const response: HealthResponse = {
      backend,
      database,
      event_log_db,
      external_services,
      cloudinary_egress,
      performance,
      errors: {
        count_last_hour: errorCount,
        recent,
      },
      log_aggregates: {
        window_hours: 1,
        by_namespace_type,
        email_dead_lettered_last_hour: emailDeadLetteredCount,
        stripe_dead_lettered_last_hour: stripeDeadLetteredCount,
      },
      email_stats: {
        sent_today: emailSentToday,
        sent_this_week: emailSentWeek,
        failed_today: emailFailedToday,
        dead_letter_unresolved: deadLetterUnresolved,
        dead_letter_oldest_at:
          deadLetterOldest?.created_at.toISOString() ?? null,
      },
      email_deliverability: getEmailDeliverabilityInfo(),
      payments,
      alert_history,
      sweeps: getSweepStatuses(),
      checked_at: new Date().toISOString(),
    };

    return success(response);
  } catch (error) {
    return databaseFailure('adminGetHealth', error);
  }
};
