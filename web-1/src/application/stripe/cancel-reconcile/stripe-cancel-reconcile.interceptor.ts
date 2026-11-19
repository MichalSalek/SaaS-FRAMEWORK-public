/**
 * STRIPE CANCEL-RECONCILE JOB, due every hour (wakes nothing: runs when the database is awake).
 *
 * Executes every queued subscription cancel: rows written after a failed cancel
 * (account deletion, admin downgrade, duplicate checkout), write-ahead rows from the
 * checkout and bulk-downgrade transactions, and rows queued by the orphan scan
 * (stripe-orphan-subscription.interceptor.ts).
 *
 * The job lease gives one run per interval; the per-row guarantee stays the optimistic
 * retry_count claim inside sweepPendingSubscriptionCancels (a body that outlives a lost
 * lease cannot cancel a row twice). Hour-level latency is safe: a leaked subscription bills
 * at month granularity, and the exponential backoff (resolver) spaces per-row attempts.
 */

import { TIME } from '@kernel/application/constants.config';
import { defineScheduledJob } from '@app/scheduler/scheduled-job';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { sweepPendingSubscriptionCancels } from './stripe-cancel-reconcile.operations';

export const stripeCancelReconcileJob = defineScheduledJob({
  name: 'stripe-cancel-reconcile',
  // DECISION: does not wake a sleeping database on its own (Neon budget); at zero traffic it runs
  // in the next tick round of a waking job: at most the wake floor (6 h) later by day, up to ~12.5 h
  // overnight (last round just before 21:00 UTC, next one at the first tick after 09:00). Monthly
  // billing makes that safe.
  wakesOnTick: false,
  intervalMs: TIME.MS_PER_HOUR,
  run: async () => {
    const result = await sweepPendingSubscriptionCancels();

    if (result.scanned > 0) {
      reportIssueBackend({
        namespace: 'stripeCancelReconcileInterceptor',
        message: `Cancel-reconcile sweep complete: ${result.succeeded}/${result.retried} cancels succeeded, ${result.deadLettered} dead-lettered`,
        payload: result,
        mode: result.failed > 0 || result.deadLettered > 0 ? 'warn' : 'info',
      });
    }
  },
});
