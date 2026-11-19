// Attention counts: "things waiting for the admin" per menu item of the panel (badge in the
// AdminLayout sidebar). Keys = queue sources, not routes: one menu item maps to one counter in the
// front's sidebar config.
export type AdminAttentionCountsResponse = {
  // Support threads with status OPEN whose LAST message is from the user (awaiting a support
  // reply). Status OPEN alone is not enough: a thread the admin answered and that now waits for the
  // user must not light the badge.
  support_awaiting_reply: number;
  // Moderation reports with status PENDING (the queue to review).
  moderation_pending: number;
  // Healthcheck services with status degraded or down (main DB, log DB, Stripe, Cloudinary, email
  // service); services without configuration are skipped. The same snapshot as ADMIN_HEALTH, cached in
  // the process for ~60s so the badge poll does not trigger external checks on every refresh.
  system_health_issues: number;
  // Error-log groups inside LOG_ATTENTION_SCOPE (type=error, PRODUCTION, last
  // 7 days) whose display status is in LOG_ISSUE_ATTENTION_STATUSES: never
  // triaged (`new`) or `fixed` and seen again after the mark (`regressed`).
  // `known` and `ignored` are decisions already taken and are NOT counted.
  // List: ADMIN_GET_LOG_GROUPS with `attention: true` (adminLogsAttentionHref).
  log_issues_open: number;
  // USERS whose stylist account has subscription_status PAST_DUE, UNPAID or
  // INCOMPLETE, or is TRIALING with trial_ends_at within the next
  // ADMIN_ATTENTION.TRIAL_ENDING_WITHIN_DAYS days.
  // List: ADMIN_GET_USERS_PAGINATED with `attention: 'payments'`.
  payments_attention: number;
  // Active, not deleted users with neither a stylist nor a client account,
  // registered between STUCK_MAX_AGE_DAYS days and STUCK_MIN_AGE_HOURS hours
  // ago. List: ADMIN_GET_USERS_PAGINATED with `attention: 'stuck'`.
  stuck_accounts: number;
  // 1 when the newest EMAIL_SWEEP_COMPLETED row is missing or older than
  // ADMIN_ATTENTION.EMAIL_SWEEP_MAX_SILENCE_HOURS (measured up to the last
  // moment mail was allowed to go out, so quiet hours alone never fire it),
  // otherwise 0. Screen: the admin email schedule page ("last sweep").
  email_sweep_issues: number;
};
