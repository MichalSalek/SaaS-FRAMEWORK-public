/**
 * Canonical names of the periodic jobs. `ScheduledJobName` is derived from this
 * array, so adding a job HERE widens the union, and the registry
 * (scheduled-jobs.registry.ts) must then define it (its type demands one entry per
 * name). The names are also the primary keys of the `JobLease` table and the
 * `name` of each row in ADMIN_HEALTH `sweeps`: renaming one orphans its row and
 * re-runs the job once.
 */
export const ALL_JOB_NAMES = [
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
  'stripe-orphan-subscription-scan',
  'exchange-code-cleanup',
  'expired-session-cleanup',
  'notification-cleanup',
  'email-outbox',
  'session-activity-outbox',
] as const;

export type ScheduledJobName = (typeof ALL_JOB_NAMES)[number];
