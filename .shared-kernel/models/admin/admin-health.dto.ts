import type { IOClientFunctionReqResErr } from '../../application/http/http.client.types';
import type { DetailedErrorPayload } from '../../application/http/http.types';

// --- Health Dashboard supporting types ---

export type ServiceStatus = 'healthy' | 'degraded' | 'down';

export type ServiceHealthCheck = {
  name: string;
  status: ServiceStatus;
  latency_ms: number | null;
  message: string | null;
};

export type SweepStatus = 'ok' | 'stale' | 'never_run';

export type SweepInfo = {
  name: string;
  status: SweepStatus;
  last_run_at: string | null;
  last_duration_ms: number | null;
  last_error: string | null;
  stale_threshold_hours: number;
};

export type RecentError = {
  event_log_id: string;
  event: string;
  created_at: string;
  event_payload: Record<string, unknown> | null;
};

/**
 * One row of the AppLogs `GROUP BY namespace, type` breakdown over a recent window.
 * BDX W6.2 — lightweight, query-only observability aggregate (no in-memory windows).
 */
export type LogAggregateRow = {
  namespace: string;
  /** Log severity: 'info' | 'warn' | 'error' (AppLogs `type` column). */
  type: string;
  count: number;
};

// --- Cloudinary Egress Monitoring ---

export type CloudinaryEgressStatus = 'ok' | 'warning' | 'critical' | 'unknown';

export type EmailCircuitState = 'CLOSED' | 'WARNING' | 'OPEN';

/**
 * Email provider daily request cap breaker state. Distinct from the bounce-rate
 * circuit (`circuit_state`): this reflects whether the provider's per-day request
 * quota is currently exhausted (every send short-circuits until it resets).
 */
export type MailgunDailyLimitInfo = {
  /** True when the daily request cap is hit and sends are short-circuited. */
  limited: boolean;
  /** ISO timestamp the cap is expected to reset (Mailgun "try again after"), null when not limited. */
  reset_at: string | null;
};

export type EmailDeliverabilityInfo = {
  /** Calculated hard-bounce rate as a percentage (0-100), null if data unavailable. */
  bounce_rate_pct: number | null;
  /** Current circuit breaker state. */
  circuit_state: EmailCircuitState;
  /** ISO timestamp of last Mailgun events API poll, null if never polled. */
  last_check_at: string | null;
  /** Human-readable status message (reason for WARNING/OPEN or "ok"). */
  message: string | null;
  /** Email provider daily request-cap breaker (separate from the bounce-rate circuit). */
  daily_limit: MailgunDailyLimitInfo;
};

export type CloudinaryEgressInfo = {
  /** Egress consumed in the current billing cycle (GB), null if unknown. */
  egress_used_gb: number | null;
  /** Egress plan limit (GB), null if not determinable. */
  egress_limit_gb: number | null;
  /** Percentage of egress limit consumed (0-100+), null if unknown. */
  egress_pct: number | null;
  /** ok = <70%, warning = 70-89%, critical = >=90%, unknown = API unavailable. */
  egress_status: CloudinaryEgressStatus;
  /** ISO timestamp when this data was fetched (may be from cache). */
  fetched_at: string | null;
  /** Human-readable message, e.g. reason for unknown status. */
  message: string | null;
};

// Idempotent setter (testy-api s34): the TARGET state, not a toggle. The blind
// toggle flipped process-wide logging on any body, so a retry or double click
// undid itself and nobody could set a known state.
type SwitchBackendDebugModeRequest = {
  enabled: boolean;
  /** true = the DB leaks debugger, absent/false = verbose logging. */
  debug_db?: boolean;
};

type AdminHealthResponse = {
  backend: {
    uptime_seconds: number;
    memory_usage_mb: number;
    memory_total_mb: number;
    node_version: string;
    environment: string;
  };
  database: ServiceHealthCheck & {
    /** P95 query latency from pg_stat_statements. Null when extension is not enabled. */
    p95_query_latency_ms: number | null;
  };
  event_log_db: ServiceHealthCheck;
  external_services: ServiceHealthCheck[];
  cloudinary_egress: CloudinaryEgressInfo;
  performance: {
    avg_response_time_ms: number;
    total_requests_tracked: number;
  };
  errors: {
    count_last_hour: number;
    recent: RecentError[];
  };
  /**
   * BDX W6.2 — lightweight observability aggregates pulled query-only from the
   * AppLogs DB (NO Redis, NO in-memory windowing). `by_namespace_type` is a
   * `GROUP BY namespace, type` breakdown over the last hour (LIMIT-ed); the
   * dead-letter counts surface silent-failure backlogs (email + Stripe).
   */
  log_aggregates: {
    window_hours: number;
    by_namespace_type: LogAggregateRow[];
    /** AppLogs rows for the EMAIL_DEAD_LETTERED event in the window (send fully failed). */
    email_dead_lettered_last_hour: number;
    /** AppLogs rows for the STRIPE_EVENT_JANITOR_DEAD_LETTER namespace in the window. */
    stripe_dead_lettered_last_hour: number;
  };
  email_stats: {
    sent_today: number;
    sent_this_week: number;
    failed_today: number;
    /** Unresolved rows in the failedEmail dead-letter table (resolved_at = null). */
    dead_letter_unresolved: number;
    /** ISO timestamp of the oldest unresolved dead-letter, or null if none. */
    dead_letter_oldest_at: string | null;
  };
  email_deliverability: EmailDeliverabilityInfo;
  payments: {
    /**
     * Count of STRIPE_CHARGE_DISPUTE_CREATED events in the last 30 days
     * (from EventLog). Non-zero = immediate admin action required.
     *
     * DECISION (nie usuwaj tego komentarza):
     * 30d window: Stripe dispute response window is 7 days but investigation
     * and chargebacks accumulate over billing cycles. 30d covers the full
     * billing cycle and aligns with Stripe's dispute rate calculation period
     * (used for reputation scoring). Shorter window would miss disputes opened
     * near cycle boundaries.
     */
    pending_disputes_count: number;
    /** ISO timestamp of the most recent STRIPE_CHARGE_DISPUTE_CREATED event, null if none in 30d. */
    last_dispute_at: string | null;
  };
  alert_history: Array<{
    id: string;
    event: string;
    created_at: string;
    payload: Record<string, unknown> | null;
  }>;
  sweeps: SweepInfo[];
  checked_at: string;
};

export type AdminHealthDtoApi = {
  /** Przełącza tryb debug backendu (opcjonalnie debug bazy danych), zwraca zdarzenie włączenia albo wyłączenia. */
  SWITCH_BACKEND_DEBUG_MODE: {
    REQUEST: SwitchBackendDebugModeRequest;
    RESPONSE: {
      event:
        | 'DEBUG_MODE_ENABLED'
        | 'DEBUG_MODE_DISABLED'
        | 'DEBUG_DB_MODE_ENABLED'
        | 'DEBUG_DB_MODE_DISABLED';
    };
    RESPONSE_ERROR: DetailedErrorPayload<SwitchBackendDebugModeRequest>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      SwitchBackendDebugModeRequest,
      {
        event:
          | 'DEBUG_MODE_ENABLED'
          | 'DEBUG_MODE_DISABLED'
          | 'DEBUG_DB_MODE_ENABLED'
          | 'DEBUG_DB_MODE_DISABLED';
      },
      DetailedErrorPayload<SwitchBackendDebugModeRequest>
    >;
  };

  /** Weryfikuje dostęp administratora, zwraca identyfikator serwera i znacznik czasu. */
  ADMIN_CHECK_ACCESS: {
    REQUEST: undefined;
    RESPONSE: { serverId: string; timestamp: string };
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      undefined,
      { serverId: string; timestamp: string },
      DetailedErrorPayload<undefined>
    >;
  };

  /** Zwraca pełny healthcheck systemu (backend, bazy, usługi zewnętrzne, email, płatności, logi, sweepy). */
  ADMIN_HEALTH: {
    REQUEST: undefined;
    RESPONSE: AdminHealthResponse;
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      undefined,
      AdminHealthResponse,
      DetailedErrorPayload<undefined>
    >;
  };

  /** Weryfikuje dostęp administratora do panelu zdrowia, zwraca identyfikator serwera i znacznik czasu. */
  ADMIN_CHECK_ACCESS_HEALTH: {
    REQUEST: undefined;
    RESPONSE: {
      serverId: string;
      timestamp: string;
    };
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      undefined,
      {
        serverId: string;
        timestamp: string;
      },
      DetailedErrorPayload<undefined>
    >;
  };
};
