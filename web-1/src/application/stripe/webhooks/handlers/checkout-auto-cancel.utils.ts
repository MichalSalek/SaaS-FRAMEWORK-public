import type Stripe from 'stripe';

import { reportIssueBackend } from '@app/debugger/error-handler';
import { getStripe } from '@app/stripe/adapters/stripe.adapter';
import { enqueueSubscriptionCancelReconcile } from '@app/stripe/cancel-reconcile/stripe-cancel-reconcile.operations';
import {
  retryStripeOperation,
  type StripeRetryAttempt,
} from '@app/stripe/stripe-retry.utils';
import { dispatchCriticalAlert } from '@app/stripe/webhooks/stripe-webhooks.utils';
import { stripeDashboardLinkProp } from '@app/stripe/stripe-dashboard.links';

/**
 * Stripe surfaces "already cancelled" in two shapes depending on history:
 *   - 404 `resource_missing` — subscription doesn't exist at all
 *   - 400 with message containing "canceled" / "no longer be updated" — the
 *     subscription exists in terminal canceled state and refuses further
 *     mutations
 * Both indicate the desired end-state (no double-billing) is already met.
 * DECISION (nie usuwaj tego komentarza): we treat both as idempotent success.
 */
const isAlreadyCanceledOutcome = (
  attempt: StripeRetryAttempt | undefined
): boolean => {
  if (!attempt) {
    return false;
  }
  if (attempt.errorCode === 'resource_missing') {
    return true;
  }
  const msg = attempt.errorMessage?.toLowerCase() ?? '';
  // Stripe phrases: "...has been canceled and can no longer be updated"
  // (US spelling), "cancelled" (UK spelling fallback). Status check guards
  // against false positives from unrelated 5xx messages containing the word.
  if (typeof attempt.errorStatus === 'number' && attempt.errorStatus !== 400) {
    return false;
  }
  return (
    msg.includes('has been canceled') ||
    msg.includes('has been cancelled') ||
    msg.includes('already canceled') ||
    msg.includes('already cancelled')
  );
};

/**
 * Attempts programmatic cancellation of the OLD duplicate subscription with
 * full retry + audit trail. On final failure → dispatches operator alert
 * (preserving original behavior as the safety net).
 *
 * DECISION (nie usuwaj tego komentarza):
 * We do NOT roll back the new subscription on cancel failure. The newer
 * subscription is what the user paid for and what the DB now reflects (set by
 * handleCheckoutCompleted). The risk we're mitigating is double-billing on the
 * OLD one — if cancel fails after retries, an operator alert is strictly safer
 * than touching the freshly-active subscription already linked in our DB.
 *
 * DURABILITY (nie usuwaj tego komentarza):
 * This cancel runs as a floating `runAfterResponse` effect AFTER the webhook row
 * was committed `processed=true`. If the process dies (Render SIGTERM on redeploy)
 * inside that post-commit window, the floating retry loop is lost and no janitor
 * re-runs it (the stripe-event-janitor only re-drives `processed=false` rows).
 * To reach money-durability parity with the account-deletion cancel path
 * (cancelStripeSubscriptionIfExists), on final non-idempotent failure we ALSO
 * write a durable dead-letter reconcile row (enqueueSubscriptionCancelReconcile)
 * carrying the OLD subscription id — the row survives process death and is
 * re-driven by the independent stripe-cancel-reconcile sweep regardless of the
 * webhook row's processed flag. The OLD sub id is captured here (not read from
 * the DB later): post-commit the account row already points at the NEW sub, so
 * the reconcile row itself must persist `oldSubscriptionId`.
 * Since testy-api s34 the same row is ALSO written inside the webhook transaction
 * (checkout.handler → enqueueSubscriptionCancelReconcileTx), because a process
 * killed mid-retry never reaches this final-failure branch. The enqueue here stays:
 * it re-arms the row with the real Stripe error and a fresh retry budget.
 *
 * MUST NOT throw — called from webhook handler that must always ack.
 */
export const autoCancelOldSubscription = async ({
  accountId,
  userId,
  userEmail,
  oldSubscriptionId,
  newSubscriptionId,
  session,
}: {
  accountId: string;
  userId: string;
  userEmail: string | null;
  oldSubscriptionId: string;
  newSubscriptionId: string | undefined;
  session: Stripe.Checkout.Session;
}): Promise<void> => {
  // d2f1-allow: to nie jest ścieżka w-transakcji — autoCancelOldSubscription biegnie jako
  // post-commit effect (runAfterResponse), patrz DURABILITY wyżej.
  const stripe = getStripe();

  // Defensive try/catch — webhook handlers must not throw. Adapter init
  // failure or any unexpected runtime error funnels through operator alert.
  try {
    const cancelResult = await retryStripeOperation({
      fn: () => stripe.subscriptions.cancel(oldSubscriptionId),
      namespace: 'STRIPE_DUPLICATE_SUB_AUTO_CANCEL',
      payload: {
        accountId,
        oldSubscriptionId,
        newSubscriptionId,
        sessionId: session.id,
      },
    });

    if (cancelResult.ok) {
      reportIssueBackend({
        namespace: 'STRIPE_DUPLICATE_SUB_AUTO_CANCEL_SUCCESS',
        message:
          'Successfully auto-cancelled OLD duplicate subscription (no manual intervention needed)',
        payload: {
          accountId,
          oldSubscriptionId,
          newSubscriptionId,
          attemptsCount: cancelResult.attempts.length,
          attempts: cancelResult.attempts,
        },
        mode: 'info',
      });
      return;
    }

    // Idempotency: subscription doesn't exist (404 `resource_missing`) OR
    // is already in canceled terminal state (Stripe 400 with "has been
    // canceled" message). The desired outcome (no double-billing) is already
    // met — treat as success in audit, no operator alert needed.
    const lastAttempt = cancelResult.attempts[cancelResult.attempts.length - 1];
    if (isAlreadyCanceledOutcome(lastAttempt)) {
      reportIssueBackend({
        namespace: 'STRIPE_DUPLICATE_SUB_AUTO_CANCEL_ALREADY_GONE',
        message:
          'OLD subscription already canceled in Stripe — treating cancel as idempotently complete',
        payload: {
          accountId,
          oldSubscriptionId,
          newSubscriptionId,
          lastErrorCode: lastAttempt?.errorCode,
          lastErrorStatus: lastAttempt?.errorStatus,
          attempts: cancelResult.attempts,
        },
        mode: 'info',
      });
      return;
    }

    // All retries exhausted (or permanent error). Record a durable dead-letter
    // reconcile row (survives process death) BEFORE the operator alert, then
    // fall back to the human alert. Both nets are additive — never either/or.
    await enqueueDuplicateCancelReconcile({
      oldSubscriptionId,
      userId,
      reason:
        lastAttempt?.errorMessage ??
        'Duplicate-checkout OLD-sub cancel failed after retries (no error message captured)',
    });
    dispatchCancelFallbackAlert({
      accountId,
      userEmail,
      oldSubscriptionId,
      newSubscriptionId,
      session,
      attempts: cancelResult.attempts,
    });
  } catch (unexpectedError) {
    reportIssueBackend({
      namespace: 'STRIPE_DUPLICATE_SUB_AUTO_CANCEL_UNEXPECTED',
      message:
        'Unexpected error during auto-cancel attempt — falling back to operator alert',
      payload: {
        accountId,
        oldSubscriptionId,
        newSubscriptionId,
        error:
          unexpectedError instanceof Error
            ? unexpectedError.message
            : String(unexpectedError),
      },
      mode: 'error',
    });
    await enqueueDuplicateCancelReconcile({
      oldSubscriptionId,
      userId,
      reason:
        unexpectedError instanceof Error
          ? unexpectedError.message
          : String(unexpectedError),
    });
    dispatchCancelFallbackAlert({
      accountId,
      userEmail,
      oldSubscriptionId,
      newSubscriptionId,
      session,
    });
  }
};

/**
 * Persist the failed OLD-subscription cancel as a durable dead-letter reconcile
 * row so it survives process death and is re-driven by the independent
 * stripe-cancel-reconcile sweep (money-durability parity with the deletion path).
 *
 * DECISION (nie usuwaj tego komentarza):
 * We reuse the existing reconcile queue (event_type
 * `internal.subscription_cancel_reconcile`) rather than mint a new table — the
 * StripeEvent work-queue + sweep already give bounded backoff, cross-instance
 * optimistic claim, and dead-letter alert. The `userId` we pass is the account
 * owner (`created_by_user_id`), so operator diagnostics and the resolver key stay
 * well-formed (cuid, colon-free).
 *
 * DECISION (nie usuwaj tego komentarza) — DUPLICATE FLAVOR:
 * The reconcile sweep (sweepPendingSubscriptionCancels) carries a REACTIVATION
 * GUARD that resolves a row WITHOUT cancelling when the target user is
 * `is_active && deleted_at === null`. That guard is correct for the account-DELETION
 * flavor (a re-activated user's live sub must be preserved) but WRONG here: the
 * duplicate-checkout user is a live, paying stylist BY DESIGN and the OLD sub
 * genuinely double-bills. We therefore tag this row with the `duplicate` flavor
 * (CancelReconcileFlavor — encoded in the event_id prefix by the resolver) so the
 * sweep BYPASSES the reactivation guard and cancels the OLD sub regardless of the
 * user's active state. The immediate operator critical-alert
 * (dispatchCancelFallbackAlert) stays as an additive human net — never regressed.
 */
const enqueueDuplicateCancelReconcile = async ({
  oldSubscriptionId,
  userId,
  reason,
}: {
  oldSubscriptionId: string;
  userId: string;
  reason: string;
}): Promise<void> => {
  await enqueueSubscriptionCancelReconcile({
    subscriptionId: oldSubscriptionId,
    userId,
    reason,
    flavor: 'duplicate',
  });
};

const dispatchCancelFallbackAlert = ({
  accountId,
  userEmail,
  oldSubscriptionId,
  newSubscriptionId,
  session,
  attempts,
}: {
  accountId: string;
  userEmail: string | null;
  oldSubscriptionId: string;
  newSubscriptionId: string | undefined;
  session: Stripe.Checkout.Session;
  attempts?: StripeRetryAttempt[];
}): void => {
  reportIssueBackend({
    namespace: 'STRIPE_DUPLICATE_SUB_AUTO_CANCEL_FALLBACK',
    message:
      'Auto-cancel failed after retries — operator alert dispatched, manual cleanup required',
    payload: {
      accountId,
      oldSubscriptionId,
      newSubscriptionId,
      attemptsCount: attempts?.length ?? 0,
      lastErrorCode: attempts?.at(-1)?.errorCode,
      lastErrorStatus: attempts?.at(-1)?.errorStatus,
    },
    mode: 'error',
  });

  dispatchCriticalAlert({
    context: 'STRIPE_CHECKOUT_UPGRADE_OR_DUPLICATE',
    diagnostic: { sessionId: session.id, accountId },
    alert: {
      alertTitle: 'Podwójna subskrypcja: automatyczne anulowanie nie wyszło',
      alertMessage:
        'Płatność przeszła dla konta, które miało już inną aktywną subskrypcję. ' +
        'Baza wskazuje nowszą subskrypcję, a wszystkie próby anulowania starej przez API Stripe się nie udały. ' +
        'Anuluj starą subskrypcję ręcznie w panelu Stripe, żeby nie pobrać opłaty dwa razy.',
      ...stripeDashboardLinkProp('subscriptions', oldSubscriptionId),
      details: {
        accountId,
        userEmail,
        oldSubscriptionId,
        newSubscriptionId,
        customerId: session.customer,
        sessionId: session.id,
        cancelAttempts: attempts ?? [],
        timestamp: new Date().toISOString(),
      },
    },
  });
};
