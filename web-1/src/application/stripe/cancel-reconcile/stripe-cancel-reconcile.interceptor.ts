/**
 * STRIPE CANCEL-RECONCILE INTERCEPTOR — lazy cron via traffic (1h throttle).
 *
 * Retries subscription cancels that failed during account deletion (dead-letter
 * entries written by enqueueSubscriptionCancelReconcile). Fire-and-forget —
 * wired via runAfterResponse in HTTPRequestHandlerMiddleware like every other
 * sweep. Throttle + timing + NEVER-throw catch = createSweepInterceptor (BDX W4.1).
 *
 * Cross-instance dedup is NOT the throttle's job (factory contract): the real
 * guard is the optimistic retry_count claim inside sweepPendingSubscriptionCancels
 * — same guarantee the stripe-event-janitor relies on. 1h cadence (vs the
 * janitor's 60s): a leaked subscription bills at month granularity, so hour-level
 * reconcile latency is safe, and the exponential backoff (resolver) spaces
 * per-row attempts anyway.
 */

import { TIME } from '@kernel/application/constants.config';
import { createSweepInterceptor } from '@app/interceptors/create-sweep-interceptor';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { sweepPendingSubscriptionCancels } from './stripe-cancel-reconcile.operations';

export const stripeCancelReconcileInterceptor = createSweepInterceptor({
  name: 'stripe-cancel-reconcile',
  throttleMs: TIME.MS_PER_HOUR,
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
