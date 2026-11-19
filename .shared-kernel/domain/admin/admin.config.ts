// Admin module configuration constants

// ── Database query limits ──
// (The log stream has no row cap: it pages on the server, see LOG_STREAM_MAX_TAKE in
// log-triage.config.ts.)

export const QUERY_LIMITS = {
  ADMIN_LIST_DEFAULT: 100,
  PUBLIC_LIST_DEFAULT: 50,
  TOP_ITEMS: 10,
  RECENT_ITEMS: 5,
  // Cap on the AppLogs `GROUP BY namespace, type` breakdown rows on the health dashboard (bounds
  // the query and payload size).
  LOG_AGGREGATE_GROUPS: 50,
} as const;

// ── Cache TTLs (in milliseconds) ──
export const CACHE_TTL = {
  ANNOUNCEMENTS: 60_000, // 1 minute
  FEATURE_FLAGS: 60_000, // 1 minute
  RUNTIME_CONFIG: 5 * 60 * 1000, // 5 minutes
  REPORTS: 15 * 60 * 1000, // 15 minutes
  PRICING_PLANS: 60 * 60 * 1000, // 60 minutes
  CONVERSION_FUNNEL: 5 * 60 * 1000, // 5 minutes — admin polling, aggregates costly on FK joins
} as const;

// ── Report periods ──
export const REPORT_PERIODS = ['week', 'month', 'quarter'] as const;
export type ReportPeriodValue = (typeof REPORT_PERIODS)[number];

// ── Timeline event types ──
export const TIMELINE_EVENT_TYPES = [
  'ACCOUNT',
  'LOGIN',
  'GALLERY',
  'ADMIN',
  'DOMAIN',
  'EMAIL',
] as const;

// ── Security timeouts ──
// DECISION: impersonation backup TTL is 12h, deliberately shorter than SESSION_EXPIRES_IN (48h). 2h
// expired mid support session (switch-back failed with "expired backup"); 12h covers a working day
// without keeping a sensitive opaque token alive for the whole session. The sign-out kill-switch
// and eviction cleanup remove it immediately on logout or ban. Do not align it to 48h.
export const IMPERSONATION_TIMEOUT_MS = 12 * 60 * 60 * 1000; // 12 hours
