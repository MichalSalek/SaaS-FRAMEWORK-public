// Admin module configuration constants

// ── Database query limits ──
// (S122: the 1000-row log stream cap is gone — the stream pages on the
// server, see LOG_STREAM_MAX_TAKE in log-triage.config.ts.)

export const QUERY_LIMITS = {
  ADMIN_LIST_DEFAULT: 100,
  PUBLIC_LIST_DEFAULT: 50,
  TOP_ITEMS: 10,
  RECENT_ITEMS: 5,
  // BDX W6.2 — cap on the AppLogs `GROUP BY namespace, type` breakdown rows
  // surfaced on the health dashboard (bounds the query + payload size).
  LOG_AGGREGATE_GROUPS: 50,
} as const;

// ── Cache TTLs (in milliseconds) ──
export const CACHE_TTL = {
  ANNOUNCEMENTS: 60_000, // 1 minute
  FEATURE_FLAGS: 60_000, // 1 minute
  RUNTIME_CONFIG: 5 * 60 * 1000, // 5 minutes
  REPORTS: 15 * 60 * 1000, // 15 minutes
  PRICING_PLANS: 60 * 60 * 1000, // 60 minutes
  REVENUE_MRR: 5 * 60 * 1000, // 5 minutes
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
// DECISION (nie usuwaj tego komentarza):
// Impersonation backup TTL = 12h (config-decision B). Poprzednie 2h rozjeżdżało się z
// SESSION_EXPIRES_IN (48h): backup wygasał w trakcie dłuższej sesji supportowej, więc
// switch-back zwracał „expired backup" i admin musiał re-logować się (graceful, ale
// uciążliwe). 12h pokrywa realny dzień pracy admina, a jednocześnie trzyma backup
// WYRAŹNIE krócej niż sesja (48h) — wrażliwy opaque token nie żyje pełnej doby+, a
// kill-switch (sign-out hook) + eviction-cleanup i tak sprzątają go natychmiast przy
// wylogowaniu/banie. NIE zrównujemy do 48h (niepotrzebnie długo żyjący sekret).
export const IMPERSONATION_TIMEOUT_MS = 12 * 60 * 60 * 1000; // 12 hours
