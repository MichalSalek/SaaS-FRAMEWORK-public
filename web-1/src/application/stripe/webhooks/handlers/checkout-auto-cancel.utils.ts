import type Stripe from 'stripe';

import { reportIssueBackend } from '@app/debugger/error-handler';
import { getStripe } from '@app/stripe/adapters/stripe.adapter';
import {
  enqueueSubscriptionCancelReconcile,
  resolveSubscriptionCancelReconcile,
} from '@app/stripe/cancel-reconcile/stripe-cancel-reconcile.queue';
import { isAlreadyCanceledAttempt } from '@app/stripe/cancel-reconcile/stripe-cancel-reconcile.resolver';
import {
  retryStripeOperation,
  type StripeRetryAttempt,
} from '@app/stripe/stripe-retry.utils';
import { dispatchCriticalAlert } from '@app/stripe/webhooks/stripe-webhooks.utils';
import { stripeDashboardLinkProp } from '@app/stripe/stripe-dashboard.links';

// DECISION: see web-1/src/application/stripe/cancel-reconcile/stripe-cancel-reconcile.resolver.ts
// (Stripe "already canceled" counts as success). One classifier for every cancel path:
// isAlreadyCanceledAttempt.

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
  // d2f1-allow: not an in-transaction path; autoCancelOldSubscription runs as a post-commit
  // effect (runAfterResponse), see the durability DECISION above.
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
      // Close the write-ahead row from the checkout transaction (see DURABILITY).
      await resolveSubscriptionCancelReconcile({
        subscriptionId: oldSubscriptionId,
        userId,
        flavor: 'duplicate',
      });
      return;
    }

    // Idempotency: subscription doesn't exist (404 `resource_missing`) OR
    // is already in canceled terminal state (Stripe 400 with "has been
    // canceled" message). The desired outcome (no double-billing) is already
    // met — treat as success in audit, no operator alert needed.
    const lastAttempt = cancelResult.attempts[cancelResult.attempts.length - 1];
    if (isAlreadyCanceledAttempt(lastAttempt)) {
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
      // Close the write-ahead row from the checkout transaction (see DURABILITY).
      await resolveSubscriptionCancelReconcile({
        subscriptionId: oldSubscriptionId,
        userId,
        flavor: 'duplicate',
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
 * Persist the failed OLD-subscription cancel as a durable dead-letter reconcile row so it
 * survives process death and is re-driven by the stripe-cancel-reconcile sweep.
 *
 * DECISION: reuse the existing reconcile queue (event_type `internal.subscription_cancel_reconcile`)
 * instead of a new table: the StripeEvent work-queue already gives bounded backoff,
 * cross-instance optimistic claim and a dead-letter alert. `userId` is the account owner
 * (`created_by_user_id`), so the resolver key stays well-formed (cuid, colon-free).
 *
 * DECISION: DUPLICATE FLAVOR. The sweep's REACTIVATION GUARD resolves a row WITHOUT cancelling
 * when the target user is `is_active && deleted_at === null`. That is right for the DELETION
 * flavor but WRONG here: the duplicate-checkout user is a live, paying stylist and the OLD sub
 * genuinely double-bills. The `duplicate` tag (event_id prefix) makes the sweep BYPASS the
 * guard. The immediate operator alert (dispatchCancelFallbackAlert) stays as an additive net.
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
