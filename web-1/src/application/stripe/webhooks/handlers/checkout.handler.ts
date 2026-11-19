import type Stripe from 'stripe';
import {
  acceptsCheckoutAttempt,
  reportUnexpectedAttempt,
} from './checkout-attempt-event.guard';
import type { Prisma } from '../../../../prisma/js-client';
import { AccountStatusValue } from '@kernel/models/db_models.generated.dto';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { mapStripeStatusToPaymentStatus } from '@kernel/models/db_models.manual.dto';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { updateAccountPlanStatus } from '@app/stripe/plan-status-update.operations';
import { acquireAdvisoryXactLock } from '@app/db/lock-rows';
import { enqueueSubscriptionCancelReconcileTx } from '@app/stripe/cancel-reconcile/stripe-cancel-reconcile.queue';
import {
  extractCustomerId,
  parseCheckoutMetadata,
} from '@app/stripe/webhooks/stripe-webhooks.utils';
import {
  type StripeHandlerResult,
  type StripeWebhookEffect,
} from '@app/stripe/webhooks/stripe-effects.types';
import {
  resolveCheckoutUser,
  validateCheckoutData,
  detectDuplicateSubscription,
  extractCheckoutSubscriptionDates,
  queueUpgradeConfirmationEmail,
} from './checkout.handler.utils';

/**
 * Expansion set required by handleCheckoutCompleted (line items → price → product, plus the
 * subscription). SSOT shared by the pre-transaction prefetch (stripe-event-prefetch.ts) and the
 * router's fallback retrieve, so the two cannot drift into expanding different shapes.
 */
export const CHECKOUT_SESSION_EXPAND = [
  'line_items',
  'line_items.data.price',
  'line_items.data.price.product',
  'subscription',
] as const;

export const handleCheckoutCompleted = async ({
  session,
  eventCreatedAt,
  tx,
}: {
  session: Stripe.Checkout.Session;
  eventCreatedAt: Date;
  tx?: Prisma.TransactionClient;
}): Promise<StripeHandlerResult> => {
  const effects: StripeWebhookEffect[] = [];

  const metadata = parseCheckoutMetadata({ metadata: session.metadata });
  const clientReferenceId = session.client_reference_id;
  const customerEmail = metadata.userEmail ?? session.customer_email;

  reportIssueBackend({
    namespace: 'STRIPE_CHECKOUT_PROCESSING',
    message: 'Processing checkout session',
    payload: {
      sessionId: session.id,
      clientReferenceId,
      customerEmail,
      metadata,
    },
    mode: 'info',
  });

  // DECISION: per-account serialization BEFORE reading the account snapshot. Two concurrent
  // `checkout.session.completed` of the SAME account (two tabs/cards; easy under a no-charge
  // trial) would otherwise BOTH read subscription_id=null, so detectDuplicateSubscription returns
  // null in both and neither queues the auto-cancel: the older subscription stays live in Stripe,
  // untracked in the DB (ghost double billing after trial). Key = customerId (customer<->account
  // 1:1), the SAME advisory key as subscription-lifecycle.handler, so checkout and subscription.*
  // events of one account serialize together. `tx` is present in the hot path and janitor; outside
  // a tx (edge) the lock is skipped (best-effort, parity with the lifecycle handler).
  const lockCustomerId = extractCustomerId({ customer: session.customer });
  if (tx && lockCustomerId) {
    await acquireAdvisoryXactLock(tx, lockCustomerId);
  }

  // 1. Resolve user + stylist account
  // DECISION: `effects` is passed INTO the helpers so critical-alert effects they queue
  // (no-account, no-plan, no-customer) are scheduled by the post-commit collector AFTER the
  // surrounding $transaction commits; firing `dispatchCriticalAlert` directly emitted alerts even
  // when the webhook tx rolled back. `tx` is threaded into the read so the subscription_id
  // snapshot is consistent with the advisory-lock serialization above.
  let user = await resolveCheckoutUser({
    session,
    clientReferenceId,
    customerEmail,
    effects,
    ...(tx && { tx }),
  });
  if (!user) {
    return { effects };
  }

  // 2. Validate planId + customerId
  const checkoutData = await validateCheckoutData({
    session,
    customerEmail,
    clientReferenceId,
    effects,
  });
  if (!checkoutData) {
    return { effects };
  }

  const { validatedPlanId, pricingPlanValue, customerId, subscriptionId } =
    checkoutData;

  // Tagged events must remain fenced until the plan write commits. The customer
  // advisory lock alone does not serialize with checkout generation rotation.
  const attemptId = session.metadata?.attemptId;
  if (attemptId) {
    const accepted =
      session.metadata?.accountId === user.stylist_account.account_id &&
      (await acceptsCheckoutAttempt({
        tx,
        userId: user.stylist_account.created_by_user_id,
        accountId: user.stylist_account.account_id,
        attemptId,
        sessionId: session.id,
        ...(subscriptionId ? { subscriptionId } : {}),
      }));
    if (!accepted) {
      const sub =
        typeof session.subscription === 'object' ? session.subscription : null;
      effects.push(
        ...reportUnexpectedAttempt(
          user.stylist_account.account_id,
          sub?.status === 'active' ||
            sub?.status === 'trialing' ||
            sub?.status === 'past_due' ||
            session.payment_status === 'paid'
        )
      );
      return { effects };
    }
    // Account may have changed while the User row lock was being acquired.
    const refreshed = await resolveCheckoutUser({
      session,
      clientReferenceId,
      customerEmail,
      effects,
      ...(tx && { tx }),
    });
    if (
      !refreshed ||
      refreshed.stylist_account.account_id !== user.stylist_account.account_id
    ) {
      throw new Error('Checkout account changed while locking');
    }
    user = refreshed;
  }
  // A late terminal legacy checkout cannot replace a different current subscription.
  const expanded =
    typeof session.subscription === 'object' ? session.subscription : null;
  if (
    !attemptId &&
    subscriptionId &&
    user.stylist_account.subscription_id &&
    subscriptionId !== user.stylist_account.subscription_id &&
    (expanded?.status === 'canceled' ||
      expanded?.status === 'incomplete_expired')
  ) {
    return { effects };
  }

  if (
    attemptId &&
    subscriptionId &&
    user.stylist_account.subscription_id &&
    user.stylist_account.subscription_id !== subscriptionId
  ) {
    const current = await tx?.stylistAccount.findUnique({
      where: { account_id: user.stylist_account.account_id },
      select: { subscription_status: true },
    });
    if (
      current?.subscription_status !== 'CANCELED' &&
      current?.subscription_status !== 'INCOMPLETE_EXPIRED'
    ) {
      effects.push(
        ...reportUnexpectedAttempt(
          user.stylist_account.account_id,
          expanded?.status === 'active' ||
            expanded?.status === 'trialing' ||
            expanded?.status === 'past_due' ||
            session.payment_status === 'paid'
        )
      );
      return { effects };
    }
  }

  // 3. Detect duplicate/orphaned subscriptions — returns a post-commit
  //    effect to auto-cancel the OLD subscription (or null if none).
  const cancelEffect = detectDuplicateSubscription({
    account: user.stylist_account,
    userEmail: user.email,
    newSubscriptionId: subscriptionId,
    session,
  });

  // 4. Extract subscription dates from expanded session
  const {
    subscriptionStatus,
    isSubscriptionActive,
    cancelAtPeriodEnd,
    cancelAt,
    currentPeriodEnd,
  } = extractCheckoutSubscriptionDates({ session });

  // DECISION: ENTITLEMENT-ACTIVE GATE. `pricing_plan` is the only source of entitlements
  // (gallery-create / user-query read only it). Checkout and subscription.* are TWO writers of a
  // paid plan; we promote to a paid plan ONLY when the subscription really gives access
  // (active/trialing/past_due grace) and write FREE for non-paying statuses (incomplete,
  // incomplete_expired, unpaid, canceled, paused), or an abandoned SCA would grant PRO quota
  // before payment.
  //
  // account_status STAYS ACTIVE (never NOT_ACTIVE for non-entitling): NOT_ACTIVE is RESERVED for
  // moderation-ban / charge-dispute / bulk-disable and account-free-selection deliberately does
  // not reactivate from it (anti-abuse). Writing it for an abandoned incomplete checkout would
  // trap a FREE user (requireStylistAccount blocks everything and free-select cannot unblock).
  // FREE + ACTIVE is a correct free user; real status downgrade is done by lifecycle on terminal
  // subscription.* events.
  const entitledPricingPlan = isSubscriptionActive
    ? pricingPlanValue
    : PricingPlanValue.FREE;

  reportIssueBackend({
    namespace: 'STRIPE_CHECKOUT_COMPLETED',
    message: 'Processing checkout completion',
    payload: {
      accountId: user.stylist_account.account_id,
      planId: validatedPlanId,
      customerId,
      subscriptionId,
      currentPeriodEnd,
    },
    mode: 'info',
  });

  // 5. Update account plan status via SSOT function (includes stripe_customer_id)
  // DECISION: stripeEventAt = event.created, so checkout goes through the SAME out-of-order guard
  // as the subscription.* handlers. It closes resurrection: an old `checkout.session.completed`
  // replayed by the janitor after `subscription.deleted` (which bumped last_stripe_event_at) no
  // longer overwrites FREE with PAID. stripe_customer_id is written independently at session
  // creation (getOrCreateStripeCustomer), so a skipped write loses no reference. payment_status
  // is derived from the subscription status (like the lifecycle handler and sync), not hardcoded
  // PAID: active/trialing map to PAID, an incomplete edge no longer gets PAID before payment.
  const planApplied = await updateAccountPlanStatus({
    accountId: user.stylist_account.account_id,
    stripeEventAt: eventCreatedAt,
    pricingPlan: entitledPricingPlan,
    paymentStatus: mapStripeStatusToPaymentStatus(subscriptionStatus),
    accountStatus: AccountStatusValue.ACTIVE,
    subscriptionStatus,
    subscriptionId: subscriptionId ?? null,
    stripeCustomerId: customerId,
    cancelAtPeriodEnd,
    cancelAt,
    currentPeriodEnd,
    oldPricingPlan: user.stylist_account.pricing_plan,
    source: 'stripe',
    createdByUserId: user.id,
    ...(tx && { tx }),
  });

  reportIssueBackend({
    namespace: 'STRIPE_CHECKOUT_SUCCESS',
    message: planApplied
      ? 'Account plan updated successfully'
      : 'Checkout plan write skipped by recency guard (newer Stripe event already applied)',
    payload: {
      accountId: user.stylist_account.account_id,
      planId: validatedPlanId,
      planApplied,
    },
    mode: 'info',
  });

  // 5b. Retire the OLD subscription — ONLY when this event's write actually applied.
  // DECISION: a stale checkout replayed after a newer event (janitor, late Stripe retry) sees the
  // account already on the NEWER sub, so its "old" id is then the LIVE subscription. The recency
  // guard skips the plan write (planApplied=false) without throwing, so without this gate the
  // cancel went out anyway and killed the subscription the customer is paying for.
  // planApplied=true means the account now points at THIS event's sub, so the captured old id is
  // redundant.
  const oldSubscriptionId = user.stylist_account.subscription_id;
  if (cancelEffect && planApplied && oldSubscriptionId && !attemptId) {
    // Outbox: the commit that makes the OLD sub redundant also records that it
    // must die, so a process killed before the post-commit cancel cannot leave
    // it billing (DECISION in enqueueSubscriptionCancelReconcileTx).
    if (tx) {
      await enqueueSubscriptionCancelReconcileTx(tx, {
        subscriptionId: oldSubscriptionId,
        userId: user.stylist_account.created_by_user_id,
        reason:
          'Duplicate checkout: OLD subscription cancel pending (enqueued with the checkout write)',
        flavor: 'duplicate',
      });
    }
    effects.push(cancelEffect);
  }

  // 6. Queue post-commit upgrade confirmation email (skipped if user has no email)
  // GATED on planApplied: when the recency guard skips a stale/out-of-order checkout
  // event (a newer Stripe event already landed), the plan write is a no-op, so we must
  // NOT send an "upgrade confirmed" email for a change that never persisted.
  // ALSO gated on isSubscriptionActive: a non-entitling checkout writes FREE (see the
  // entitlement gate above), so an "upgraded to <paid>" email would be a lie.
  if (planApplied && isSubscriptionActive) {
    const upgradeEmailEffect = await queueUpgradeConfirmationEmail({
      user,
      pricingPlanValue,
      sessionId: session.id,
      ...(tx && { tx }),
    });
    if (upgradeEmailEffect) {
      effects.push(upgradeEmailEffect);
    }
  }

  return { effects };
};
