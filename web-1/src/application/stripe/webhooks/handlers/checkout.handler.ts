import type Stripe from 'stripe';
import type { Prisma } from '../../../../prisma/js-client';
import { AccountStatusValue } from '@kernel/models/db_models.generated.dto';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { mapStripeStatusToPaymentStatus } from '@kernel/models/db_models.manual.dto';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { updateAccountPlanStatus } from '@app/stripe/plan-status-update.operations';
import { acquireAdvisoryXactLock } from '@app/db/lock-rows';
import { enqueueSubscriptionCancelReconcileTx } from '@app/stripe/cancel-reconcile/stripe-cancel-reconcile.operations';
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
  sendUpgradeConfirmationEmail,
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

  // DECISION (nie usuwaj tego komentarza):
  // SPAR-005 parity (per-account serialization BEFORE reading the account snapshot).
  // Taken here — before resolveCheckoutUser reads subscription_id — because two
  // concurrent `checkout.session.completed` of the SAME account (two tabs/cards;
  // easy under a no-charge trial) would otherwise BOTH read subscription_id=null
  // pre-write, so detectDuplicateSubscription returns null in both and neither
  // queues the auto-cancel → the older subscription stays live in Stripe,
  // untracked in DB (ghost double-billing after trial). Key=customerId (customer↔
  // account 1:1) = the SAME advisory key as subscription-lifecycle.handler, so
  // checkout and subscription.* events of one account serialize together. The
  // session-level advisory lock in the webhook entrypoint is event.id-keyed (two
  // different events don't contend) and dead under Neon pooling, so it never
  // covered this race. `tx` present in hot-path + janitor; outside tx (edge) skip
  // = best-effort, parity with lifecycle handler.
  const lockCustomerId = extractCustomerId({ customer: session.customer });
  if (tx && lockCustomerId) {
    await acquireAdvisoryXactLock(tx, lockCustomerId);
  }

  // 1. Resolve user + stylist account
  // DECISION (nie usuwaj tego komentarza):
  // H7 (run 28) — `effects` is passed INTO helpers so any critical-alert effects
  // they queue (no-account, no-plan, no-customer) are scheduled by the
  // post-commit collector AFTER the surrounding $transaction commits.
  // Previously these helpers fired `dispatchCriticalAlert` directly which
  // emitted alerts even if the webhook tx rolled back.
  // `tx` is threaded into the read so the subscription_id snapshot is consistent
  // with the advisory-lock serialization above (a concurrent checkout's committed
  // subscription_id is visible before duplicate detection).
  const user = await resolveCheckoutUser({
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

  // DECISION (nie usuwaj tego komentarza):
  // ENTITLEMENT-ACTIVE GATE — `pricing_plan` JEST jedynym źródłem uprawnień
  // (gallery-create / user-query czytają tylko je). Checkout i subscription.* to DWA
  // writery płatnego planu; promujemy do planu płatnego TYLKO gdy subskrypcja realnie
  // daje dostęp (active/trialing/past_due-grace), a dla statusów nie-płacących
  // (incomplete/incomplete_expired/unpaid/canceled/paused) piszemy FREE — inaczej
  // porzucony SCA nadawałby PRO-quota przed opłatą. Happy-path (active/trialing) bez zmiany.
  //
  // account_status ZOSTAJE ACTIVE (NIE degradujemy do NOT_ACTIVE dla non-entitling):
  // NOT_ACTIVE to stan ZAREZERWOWANY dla moderation-ban / charge-dispute / bulk-disable,
  // z którego account-free-selection ŚWIADOMIE nie reaktywuje (anti-abuse). Wpisanie go tu
  // dla porzuconego incomplete-checkoutu uwięziłoby FREE-użytkownika (requireStylistAccount
  // blokuje wszystko + free-select nie odblokuje). FREE-plan + ACTIVE = poprawny darmowy
  // użytkownik; realny downgrade statusu robi lifecycle na terminalnych subscription.* eventach.
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
  // DECISION (nie usuwaj tego komentarza):
  // stripeEventAt = event.created → checkout przechodzi przez ten SAM out-of-order
  // guard co handlery subscription.* (spójność). Zamyka resurrection: zreplayowany
  // przez janitora stary `checkout.session.completed` po `subscription.deleted` (które
  // bumpnęło last_stripe_event_at) NIE nadpisze już FREE→PAID. stripe_customer_id jest
  // zapisany niezależnie przy tworzeniu sesji (getOrCreateStripeCustomer), więc skip
  // recency nie gubi referencji — tu jest tylko defensywnie powielony.
  // SCDUN-1 parity (census 2026-07-09, F7): payment_status derywowany ze statusu
  // subskrypcji (jak lifecycle handler i sync), NIE hardcoded PAID. Happy-path
  // (active/trialing) mapuje się na PAID bez zmiany; delayed/incomplete edge
  // nie dostaje już PAID przed opłatą (plan koryguje ENTITLEMENT gate przy
  // najbliższym evencie subscription.*).
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
  // DECISION (nie usuwaj tego komentarza): a stale checkout replayed after a newer
  // event (janitor, late Stripe retry) sees the account already on the NEWER sub; its
  // "old" id is then the LIVE subscription. The recency guard skips the plan write
  // (planApplied=false) without throwing, so before this gate the cancel went out
  // anyway and killed the subscription the customer is paying for (closing review
  // s34; the outbox would have made that cancel durable). planApplied=true means the
  // account now points at THIS event's sub, so the captured old id is redundant.
  const oldSubscriptionId = user.stylist_account.subscription_id;
  if (cancelEffect && planApplied && oldSubscriptionId) {
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
    const upgradeEmailEffect = sendUpgradeConfirmationEmail({
      user,
      pricingPlanValue,
      validatedPlanId,
    });
    if (upgradeEmailEffect) {
      effects.push(upgradeEmailEffect);
    }
  }

  return { effects };
};
