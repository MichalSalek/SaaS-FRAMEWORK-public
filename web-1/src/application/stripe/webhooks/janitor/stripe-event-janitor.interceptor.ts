/**
 * STRIPE EVENT JANITOR INTERCEPTOR
 *
 * Runs once per JANITOR_RUN_INTERVAL_MS per instance (default 60s).
 * Fire-and-forget — doesn't block requests.
 *
 * Sweeps StripeEvent rows where processed=false AND not dead-lettered AND
 * created_at older than STRIPE_EVENT_JANITOR_STALE_MINUTES, retries each
 * one with the same atomic transaction the hot-path uses.
 *
 * Lazy cron via traffic. Triggered by HTTP middleware on every request.
 *
 * DECISION (nie usuwaj tego komentarza):
 * This sweep deliberately stays OUT of createSweepInterceptor (BDX W4.1) — unlike
 * the 9 cleanup/expiry sweeps it does NOT rely solely on a per-instance in-memory
 * throttle for dedup. The 60s window (DECISION D1, tighter than 24h because users
 * waiting on a paid plan expect <1min recovery) PLUS the cross-instance optimistic
 * row-claim inside sweepUnprocessedStripeEvents (UPDATE…WHERE retry_count=N) are
 * the real concurrency guard. Allowlisted in tests/audit/sweep-interceptor.sh.
 */

import { reportIssueBackend } from '@app/debugger/error-handler';
import { recordSweepRun } from '@app/health/sweep-monitoring.utils';
import { sweepUnprocessedStripeEvents } from './stripe-event-janitor.operations';
import {
  shouldAttemptStripeEventJanitor,
  updateStripeEventJanitorTimestamp,
} from './stripe-event-janitor.state';

export const stripeEventJanitorInterceptor = async (): Promise<void> => {
  if (!shouldAttemptStripeEventJanitor()) {
    return;
  }

  // Mark BEFORE async work to prevent concurrent attempts on this instance.
  // Optimistic claim inside sweep is the real race guard across instances.
  updateStripeEventJanitorTimestamp();

  const sweepStart = performance.now();

  try {
    const result = await sweepUnprocessedStripeEvents();

    if (result.scanned > 0) {
      reportIssueBackend({
        namespace: 'stripeEventJanitorInterceptor',
        message: `Janitor sweep complete: ${result.succeeded}/${result.retried} retries succeeded, ${result.deadLettered} dead-lettered`,
        payload: result,
        mode: result.failed > 0 || result.deadLettered > 0 ? 'warn' : 'info',
      });
    }

    recordSweepRun(
      'stripe-event-janitor',
      Math.round(performance.now() - sweepStart)
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    recordSweepRun(
      'stripe-event-janitor',
      Math.round(performance.now() - sweepStart),
      errorMsg
    );
    reportIssueBackend({
      namespace: 'stripeEventJanitorInterceptor',
      message: 'Stripe event janitor sweep failed',
      payload: error,
      mode: 'error',
    });
    // Don't throw — janitor failure shouldn't block requests
  }
};
