/**
 * NEWSLETTER PENDING CLEANUP INTERCEPTOR
 *
 * Runs once per 24h per instance. Fire-and-forget — doesn't block requests.
 * Deletes NewsletterSubscriber rows that never confirmed double opt-in and are
 * older than NEWSLETTER_PENDING_RETENTION_DAYS (90 days), capped per run.
 *
 * No advisory lock needed: deleteMany on already-deleted records is a no-op.
 * Concurrent instances running simultaneously just produce redundant 0-delete operations.
 *
 * Throttle + timing + NEVER-throw catch = createSweepInterceptor (BDX W4.1).
 * Triggered by: HTTP middleware (every request checks, executes if 24h passed).
 */

import { TIME } from '@kernel/application/constants.config';
import { createSweepInterceptor } from '@app/interceptors/create-sweep-interceptor';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { cleanupStaleNewsletterPending_IO } from './operations/newsletter-pending-cleanup.operations';

export const newsletterPendingCleanupInterceptor = createSweepInterceptor({
  name: 'newsletter-pending-cleanup',
  throttleMs: TIME.MS_PER_DAY,
  run: async () => {
    const result = await cleanupStaleNewsletterPending_IO();

    if (result.success && result.data.deleted > 0) {
      reportIssueBackend({
        namespace: 'newsletterPendingCleanupInterceptor',
        message: `Deleted ${result.data.deleted} stale unconfirmed NewsletterSubscriber records`,
        payload: { deleted: result.data.deleted },
        mode: 'info',
      });
    }
  },
});
