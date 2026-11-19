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
 * Lightweight, query-only observability aggregate (no in-memory windows).
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
