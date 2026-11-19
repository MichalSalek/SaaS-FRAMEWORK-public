/**
 * NEWSLETTER PENDING CLEANUP JOB
 *
 * Due every 24h (durable lease in JobLease, one run per interval across processes). Fire-and-forget — doesn't block requests.
 * Deletes NewsletterSubscriber rows that never confirmed double opt-in and are
 * older than NEWSLETTER_PENDING_RETENTION_DAYS (90 days), capped per run.
 *
 * No advisory lock needed: deleteMany on already-deleted records is a no-op.
 * Concurrent instances running simultaneously just produce redundant 0-delete operations.
 *
 */

import { TIME } from '@kernel/application/constants.config';
import {
  defineScheduledJob,
  unwrapJobResult,
} from '@app/scheduler/scheduled-job';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { cleanupStaleNewsletterPending_IO } from './operations/newsletter-pending-cleanup.operations';

export const newsletterPendingCleanupJob = defineScheduledJob({
  name: 'newsletter-pending-cleanup',
  wakesOnTick: true,
  intervalMs: TIME.MS_PER_DAY,
  run: async () => {
    const data = unwrapJobResult(
      'newsletter-pending-cleanup',
      await cleanupStaleNewsletterPending_IO()
    );

    if (data.deleted > 0) {
      reportIssueBackend({
        namespace: 'newsletterPendingCleanupInterceptor',
        message: `Deleted ${data.deleted} stale unconfirmed NewsletterSubscriber records`,
        payload: { deleted: data.deleted },
        mode: 'info',
      });
    }
  },
});
