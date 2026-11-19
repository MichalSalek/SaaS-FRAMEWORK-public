/**
 * STRIPE EVENT JANITOR JOB
 *
 * Due every minute while the database is awake. Sweeps StripeEvent rows where processed=false
 * AND not dead-lettered AND created_at older than STRIPE_EVENT_JANITOR_STALE_MINUTES, and retries
 * each one with the same atomic transaction the hot path uses.
 *
 * DECISION: 60 s interval, tighter than every other job: users waiting for a paid plan after a
 * webhook hiccup expect recovery within a minute, and Stripe's own redelivery is ~5 min apart. The
 * job does NOT wake a sleeping database (wakesOnTick: false): at zero traffic nobody is waiting on a
 * plan, Stripe keeps redelivering for 3 days, and the job runs in the next tick round of a waking
 * job (within 6 h by day, up to ~12.5 h overnight). The scheduler lease gives one run per interval across processes; the per-event guarantee
 * stays the optimistic row claim inside sweepUnprocessedStripeEvents (UPDATE...WHERE
 * retry_count=N), so a body that outlives a lost lease cannot retry an event twice.
 */

import { TIME } from '@kernel/application/constants.config';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { defineScheduledJob } from '@app/scheduler/scheduled-job';
import { sweepUnprocessedStripeEvents } from './stripe-event-janitor.operations';

export const stripeEventJanitorJob = defineScheduledJob({
  name: 'stripe-event-janitor',
  wakesOnTick: false,
  intervalMs: TIME.MS_PER_MINUTE,
  run: async () => {
    const result = await sweepUnprocessedStripeEvents();

    if (result.scanned > 0) {
      reportIssueBackend({
        namespace: 'stripeEventJanitorInterceptor',
        message: `Janitor sweep complete: ${result.succeeded}/${result.retried} retries succeeded, ${result.deadLettered} dead-lettered`,
        payload: result,
        mode: result.failed > 0 || result.deadLettered > 0 ? 'warn' : 'info',
      });
    }
  },
});
