import type { ScheduledJobName } from './job-names';
import type { ScheduledJob } from './scheduled-job';
import { emailLifecycleJob } from '@app/email-handler/lifecycle/email-lifecycle.orchestrator';
import { pairingCleanupJob } from '@app/interceptors/pairing-cleanup-interceptor';
import { sessionContainerExpiryJob } from '@app/interceptors/session-container-expiry-interceptor';
import { expiredSessionCleanupJob } from '@app/interceptors/expired-session-cleanup-interceptor';
import { stripeEventJanitorJob } from '@app/stripe/webhooks/janitor/stripe-event-janitor.interceptor';
import { stripeCancelReconcileJob } from '@app/stripe/cancel-reconcile/stripe-cancel-reconcile.interceptor';
import { stripeOrphanSubscriptionScanJob } from '@app/stripe/cancel-reconcile/stripe-orphan-subscription.interceptor';
import { emailOutboxJob } from '@app/email-handler/outbox/email-outbox.job';
import { exchangeCodeCleanupJob } from '@app/auth/better-auth/exchange-code-cleanup.interceptor';
import {
  eventLogCleanupJob,
  aiCrawlerCleanupJob,
  impersonationBackupCleanupJob,
  recoveryExpiryJob,
  featureFlagExpiryJob,
  newsletterPendingCleanupJob,
  notificationCleanupJob,
  sessionActivityOutboxJob,
} from '@app/interceptors/domain-interceptors';

/** One entry per job name; the type fails to compile when a name has no job or a key holds another job. */
const JOBS_BY_NAME: {
  readonly [Name in ScheduledJobName]: ScheduledJob & { name: Name };
} = {
  'stripe-event-janitor': stripeEventJanitorJob,
  'stripe-cancel-reconcile': stripeCancelReconcileJob,
  'stripe-orphan-subscription-scan': stripeOrphanSubscriptionScanJob,
  'session-container-expiry': sessionContainerExpiryJob,
  'email-lifecycle': emailLifecycleJob,
  'pairing-cleanup': pairingCleanupJob,
  'event-log-cleanup': eventLogCleanupJob,
  'ai-crawler-cleanup': aiCrawlerCleanupJob,
  'newsletter-pending-cleanup': newsletterPendingCleanupJob,
  'impersonation-backup-cleanup': impersonationBackupCleanupJob,
  'recovery-expiry': recoveryExpiryJob,
  'feature-flag-expiry': featureFlagExpiryJob,
  'exchange-code-cleanup': exchangeCodeCleanupJob,
  'expired-session-cleanup': expiredSessionCleanupJob,
  'notification-cleanup': notificationCleanupJob,
  'email-outbox': emailOutboxJob,
  'session-activity-outbox': sessionActivityOutboxJob,
};

export const SCHEDULED_JOBS: ReadonlyArray<ScheduledJob> =
  Object.values(JOBS_BY_NAME);
