/**
 * Backstop for durable send intents whose post-commit kick never ran. Also retries an
 * ambiguous Resend send, marks a dead worker's `sending` row `unknown`, and dead-letters
 * the rest.
 * DECISION: 1 minute interval and `wakesOnTick: false`, same as the Stripe janitor. Waking
 * the database every minute for an empty queue would end scale-to-zero. The store claim is
 * the per-message fence.
 * Test: web-1/tests/postgres/email-outbox.crash.test.ts (Resend-only retry with the same
 * key; not a provider that accepts without acknowledging).
 */

import { TIME } from '@kernel/application/constants.config';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { defineScheduledJob } from '@app/scheduler/scheduled-job';
import { JobLeaseLostError } from '@app/scheduler/job-runner';
import { processEmailOutbox_IO } from './email-outbox';

export const emailOutboxJob = defineScheduledJob({
  name: 'email-outbox',
  wakesOnTick: false,
  intervalMs: TIME.MS_PER_MINUTE,
  run: async ({ signal }) => {
    const result = await processEmailOutbox_IO({ signal });
    if (result.scanned > 0) {
      reportIssueBackend({
        namespace: 'EMAIL_OUTBOX',
        message: `Outbox round: ${result.sent} sent, ${result.retryScheduled} retry scheduled, ${result.deadLettered} dead-lettered, ${result.interrupted} interrupted`,
        payload: result,
        mode: result.deadLettered > 0 ? 'warn' : 'info',
      });
    }
    if (result.aborted) {
      throw new JobLeaseLostError('email-outbox');
    }
  },
});
