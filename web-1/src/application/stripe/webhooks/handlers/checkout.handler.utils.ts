import type Stripe from 'stripe';
import type { Prisma } from '../../../../prisma/js-client';
import {
  getPlanDisplayName,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { SubscriptionStatusValue } from '@kernel/models/db_models.generated.dto';
import { mapStripeStatusToSubscriptionStatus } from '@kernel/models/db_models.manual.dto';
import { reportIssueBackend } from '@app/debugger/error-handler';
import {
  getPricingPlanValueFromPlanId,
  isStripeSubscriptionActive,
  UNKNOWN_PLAN_ID,
  getValidPlanIds,
} from '@app/stripe/stripe.config';
import { sendTransactionalEmail } from '@app/email-handler/email-transactional';
import {
  findUserByReferenceOrEmail,
  findUserByStripeCustomerId,
} from '@app/stripe/webhooks/stripe-webhooks.db';
import {
  buildCriticalAlertEffect,
  extractCustomerId,
  extractPlanIdFromCheckout,
  extractSubscriptionId,
  parseCheckoutMetadata,
  validatePlanId,
} from '@app/stripe/webhooks/stripe-webhooks.utils';
import type { StripeWebhookEffect } from '@app/stripe/webhooks/stripe-effects.types';
import { autoCancelOldSubscription } from './checkout-auto-cancel.utils';
import { stripeDashboardLinkProp } from '@app/stripe/stripe-dashboard.links';

// ─── Types ──────────────────────────────────────────────────────────────

/** User + stylist account resolved from Stripe checkout session */
export type ResolvedCheckoutUser = {
  id: string;
  email: string | null;
  stylist_account: {
    account_id: string;
    pricing_plan: PricingPlan;
    stripe_customer_id: string | null;
    subscription_id: string | null;
    created_by_user_id: string;
  };
};

/** Validated data needed to apply the checkout to the account */
export type ValidatedCheckoutData = {
  validatedPlanId: string;
  pricingPlanValue: PricingPlan;
  customerId: string;
  subscriptionId: string | undefined;
};

/** Subscription date fields extracted from expanded session */
export type CheckoutSubscriptionDates = {
  subscriptionStatus: (typeof SubscriptionStatusValue)[keyof typeof SubscriptionStatusValue];
  /** True when the subscription's Stripe status grants access (active/trialing/
   *  past_due-grace). Parity with subscription-lifecycle's entitlement gate —
   *  a checkout completing on a non-entitling status must NOT promote to a paid
   *  plan. `true` when the session has no expanded subscription (unknown status,
   *  preserves the prior unconditional-promote behavior). */
  isSubscriptionActive: boolean;
  cancelAtPeriodEnd: boolean;
  cancelAt: Date | null;
  currentPeriodEnd: Date | null;
};

// ─── Sub-functions ──────────────────────────────────────────────────────

// DECISION (nie usuwaj tego komentarza):
// H7 (run 28) — `effects[]` is passed in by the caller (handleCheckoutCompleted)
// rather than returned alongside the resolved user, so the validation helpers can
// queue post-commit alert effects WITHOUT changing their `Promise<X | null>`
// return shape. Without this the helpers would have to return tuples and every
// caller would need refactoring. Effects pushed here are scheduled post-commit
// in pages/api/v1/webhooks/stripe/index.ts → D1 atomicity preserved (rolled-back
// tx fires zero alerts).
export const resolveCheckoutUser = async ({
  session,
  clientReferenceId,
  customerEmail,
  effects,
  tx,
}: {
  session: Stripe.Checkout.Session;
  clientReferenceId: string | null;
  customerEmail: string | null;
  effects: StripeWebhookEffect[];
  tx?: Prisma.TransactionClient;
}): Promise<ResolvedCheckoutUser | null> => {
  // Read THROUGH the webhook tx so `subscription_id` reflects a concurrent
  // checkout of the same account that the caller has already serialized via the
  // per-account advisory lock — otherwise duplicate-subscription detection races
  // on a stale pre-lock snapshot (two checkouts both see subscription_id=null).
  let user = await findUserByReferenceOrEmail({
    clientReferenceId,
    customerEmail,
    ...(tx && { tx }),
  });

  // DECISION (nie usuwaj tego komentarza):
  // Robustness fallback (pure defense-in-depth on the already-null branch — zero
  // happy-path impact). `client_reference_id` + `customer_email` are BOTH one
  // missing field away from a false CRITICAL, yet a genuine nailfolio session
  // carries `session.customer`, which equals `stylist_account.stripe_customer_id`
  // (@unique). Retry via THAT before the last-resort alert; the alert still fires
  // for a truly orphaned session. Reads thread `tx` for parity with the primary
  // lookup (advisory-lock snapshot consistency). Does NOT suppress the out-of-scope
  // false positive: an unscoped customer isn't in nailfolio's DB (orthogonal to the
  // isOutOfScopeSession guard).
  //
  // DELIBERATELY the ONLY fallback key (a `metadata.accountId` fallback was
  // considered and REJECTED, /spar cross-model finding): the per-account advisory
  // lock is keyed on `session.customer` (checkout.handler.ts). Resolving via
  // `session.customer → stripe_customer_id` keeps resolved-account.customer ===
  // lock-key by construction — consistent. Resolving via raw `metadata.accountId`
  // would decouple the resolved account from the lock key: a session whose
  // `customer` differs from the resolved account's stored `stripe_customer_id`
  // would (a) overwrite that account's customer id (orphaning the prior
  // subscription) and (b) break the per-account serialization invariant (two
  // webhooks locking different customer keys while mutating the same account row).
  // `metadata.accountId` is also untyped (not in CheckoutMetadata) — too weak a
  // foundation for a billing-mutating lookup. So: customer-id fallback only.
  if (!user || !user.stylist_account) {
    const fallbackCustomerId = extractCustomerId({
      customer: session.customer,
    });
    if (fallbackCustomerId) {
      user = await findUserByStripeCustomerId(fallbackCustomerId, tx);
    }
  }

  if (!user || !user.stylist_account) {
    reportIssueBackend({
      namespace: 'STRIPE_CHECKOUT_NO_ACCOUNT',
      message: 'CRITICAL: Cannot find stylist account for checkout',
      payload: { sessionId: session.id, customerEmail, clientReferenceId },
      mode: 'error',
    });
    effects.push(
      buildCriticalAlertEffect({
        context: 'STRIPE_CHECKOUT_NO_ACCOUNT',
        diagnostic: { sessionId: session.id },
        alert: {
          alertTitle: 'Płatność bez konta stylistki',
          ...stripeDashboardLinkProp('customers', session.customer),
          alertMessage:
            'Ktoś dokończył płatność, ale nie ma pasującego konta stylistki. Potrzebna ręczna interwencja.',
          details: {
            sessionId: session.id,
            customerEmail,
            clientReferenceId,
            amountPaid: session.amount_total,
            currency: session.currency,
            timestamp: new Date().toISOString(),
          },
        },
      })
    );
    return null;
  }

  // Honest narrowing (no cast): the guard above proved stylist_account is
  // non-null; constructing the object lets TS structurally verify the shape.
  return {
    id: user.id,
    email: user.email,
    stylist_account: user.stylist_account,
  };
};

export const validateCheckoutData = async ({
  session,
  customerEmail,
  clientReferenceId,
  effects,
}: {
  session: Stripe.Checkout.Session;
  customerEmail: string | null;
  clientReferenceId: string | null;
  effects: StripeWebhookEffect[];
}): Promise<ValidatedCheckoutData | null> => {
  const metadata = parseCheckoutMetadata({ metadata: session.metadata });

  // `extractPlanIdFromCheckout` sięga po Stripe'a WYŁĄCZNIE wtedy, gdy `price.product`
  // przyjdzie jako string ID do doexpandowania. Tu nie przyjdzie: sesja jest już
  // rozwinięta o `line_items.data.price.product` (`CHECKOUT_SESSION_EXPAND`) — albo
  // w prefetchu przed transakcją, albo przez fallbackowy expand w routerze, który ma
  // własne `d2f1-allow`. Gdyby ktoś okroił `CHECKOUT_SESSION_EXPAND`, to przestaje być prawdą.
  // d2f1-allow: cena przychodzi rozwinięta, gałąź `prices.retrieve` jest nieosiągalna
  const planId = await extractPlanIdFromCheckout(session, metadata);

  if (!planId || planId === UNKNOWN_PLAN_ID) {
    reportIssueBackend({
      namespace: 'STRIPE_CHECKOUT_NO_PLAN',
      message:
        'CRITICAL: Cannot extract planId from checkout - alert sent to admins',
      payload: {
        sessionId: session.id,
        customerEmail,
        metadata: session.metadata,
      },
      mode: 'error',
    });
    effects.push(
      buildCriticalAlertEffect({
        context: 'STRIPE_CHECKOUT_NO_PLAN',
        diagnostic: { sessionId: session.id },
        alert: {
          alertTitle: 'Płatność bez poprawnego planId',
          ...stripeDashboardLinkProp('customers', session.customer),
          alertMessage:
            'Płatność przeszła, ale planId jest pusty albo niepoprawny. Plan konta trzeba podnieść ręcznie.',
          details: {
            sessionId: session.id,
            customerId: session.customer,
            customerEmail: session.customer_email,
            amountPaid: session.amount_total,
            currency: session.currency,
            extractedPlanId: planId,
            validPlanIds: getValidPlanIds(),
            metadata: session.metadata,
            checkoutUrl: session.url,
            timestamp: new Date().toISOString(),
          },
        },
      })
    );
    return null;
  }

  const validatedPlanId = validatePlanId({ planId });
  if (!validatedPlanId) {
    reportIssueBackend({
      namespace: 'STRIPE_CHECKOUT_INVALID_PLAN',
      message:
        'CRITICAL: Invalid planId in checkout metadata after initial check passed',
      payload: { sessionId: session.id, planId },
      mode: 'error',
    });
    effects.push(
      buildCriticalAlertEffect({
        context: 'STRIPE_CHECKOUT_INVALID_PLAN',
        diagnostic: { sessionId: session.id },
        alert: {
          alertTitle: 'Płatność z niepoprawnym planId',
          ...stripeDashboardLinkProp('customers', session.customer),
          alertMessage: `PlanId „${planId}” nie przeszedł walidacji, choć minął wstępne sprawdzenie null i UNKNOWN.`,
          details: {
            sessionId: session.id,
            planId,
            timestamp: new Date().toISOString(),
          },
        },
      })
    );
    return null;
  }

  const customerId = extractCustomerId({ customer: session.customer });
  if (!customerId) {
    reportIssueBackend({
      namespace: 'STRIPE_CHECKOUT_NO_CUSTOMER',
      message: 'CRITICAL: Checkout has no customer ID',
      payload: { sessionId: session.id },
      mode: 'error',
    });
    effects.push(
      buildCriticalAlertEffect({
        context: 'STRIPE_CHECKOUT_NO_CUSTOMER',
        diagnostic: { sessionId: session.id },
        alert: {
          alertTitle: 'Płatność bez identyfikatora klienta Stripe',
          alertMessage:
            'Sesja płatności zakończyła się bez identyfikatora klienta Stripe. Nie da się przypisać płatności do konta.',
          details: {
            sessionId: session.id,
            customerEmail,
            clientReferenceId,
            timestamp: new Date().toISOString(),
          },
        },
      })
    );
    return null;
  }

  const subscriptionId = extractSubscriptionId({
    subscription: session.subscription,
  });

  return {
    validatedPlanId,
    pricingPlanValue: getPricingPlanValueFromPlanId(validatedPlanId),
    customerId,
    subscriptionId,
  };
};

/**
 * Detect a duplicate/orphaned subscription on the account and prepare a
 * post-commit effect to programmatically cancel the OLD subscription via
 * the Stripe API.
 *
 * Flow:
 *   1. Account already has subscription_id AND it differs from incoming one
 *   2. Return a StripeWebhookEffect that, when invoked post-commit, delegates
 *      to `autoCancelOldSubscription`. The retry loop (up to ~7s wall time on
 *      3 backoff cycles) runs outside the webhook tx so it does NOT block the
 *      Stripe webhook ack and never fires for a rolled-back transaction.
 *
 * DECISION (nie usuwaj tego komentarza):
 * The OLD subscription_id is read and captured by closure BEFORE this fn
 * returns, so even if the surrounding `updateAccountPlanStatus` overwrites
 * the DB row, the cancel still targets the correct old id. Effect is queued
 * (not scheduled inline) so the post-commit collector in `pages/api/v1/
 * webhooks/stripe/index.ts` is the SOLE site invoking `runAfterResponse` —
 * guaranteeing D1 atomicity: a rolled-back transaction fires zero side
 * effects.
 *
 * Must not throw — sync portion only does a quick log + builds the effect.
 * The async cancel path itself is defensively wrapped (see
 * checkout-auto-cancel.utils.ts).
 *
 * @returns a `StripeWebhookEffect` to be appended to handler result, or
 *   `null` when there is no duplicate (caller skips push).
 */
export const detectDuplicateSubscription = ({
  account,
  userEmail,
  newSubscriptionId,
  session,
}: {
  account: ResolvedCheckoutUser['stylist_account'];
  userEmail: string | null;
  newSubscriptionId: string | undefined;
  session: Stripe.Checkout.Session;
}): StripeWebhookEffect | null => {
  const oldSubscriptionId = account.subscription_id;

  // No new subscription on the session = nothing replaced the stored one; cancelling
  // it would leave the account with no subscription at all (closing review s34).
  if (
    !oldSubscriptionId ||
    !newSubscriptionId ||
    oldSubscriptionId === newSubscriptionId
  ) {
    return null;
  }

  reportIssueBackend({
    namespace: 'STRIPE_CHECKOUT_UPGRADE_OR_DUPLICATE',
    message:
      'User already has a subscription, queueing post-commit auto-cancel of OLD subscription',
    payload: {
      accountId: account.account_id,
      oldSubId: oldSubscriptionId,
      newSubId: newSubscriptionId,
    },
    mode: 'warn',
  });

  return () =>
    autoCancelOldSubscription({
      accountId: account.account_id,
      // Account owner — threaded so the durable dead-letter reconcile row keyed
      // in autoCancelOldSubscription has a well-formed (cuid) userId for the
      // sweep's resolver and operator diagnostics.
      userId: account.created_by_user_id,
      userEmail,
      oldSubscriptionId,
      newSubscriptionId,
      session,
    });
};

export const extractCheckoutSubscriptionDates = ({
  session,
}: {
  session: Stripe.Checkout.Session;
}): CheckoutSubscriptionDates => {
  let subscription: Stripe.Subscription | null = null;
  if (
    session.subscription != null &&
    typeof session.subscription !== 'string'
  ) {
    subscription = session.subscription as Stripe.Subscription;
  }

  const firstItemPeriodEnd = subscription?.items?.data?.[0]?.current_period_end;
  const currentPeriodEnd = firstItemPeriodEnd
    ? new Date(firstItemPeriodEnd * 1000)
    : null;
  const cancelAt = subscription?.cancel_at
    ? new Date(subscription.cancel_at * 1000)
    : null;

  return {
    subscriptionStatus: subscription?.status
      ? mapStripeStatusToSubscriptionStatus(subscription.status)
      : SubscriptionStatusValue.ACTIVE,
    // No expanded subscription → unknown status → treat as active (preserves the
    // prior unconditional-promote behavior; the subsequent subscription.* event
    // reconciles through the lifecycle entitlement gate).
    isSubscriptionActive: subscription
      ? isStripeSubscriptionActive({ status: subscription.status })
      : true,
    cancelAtPeriodEnd: subscription?.cancel_at_period_end ?? false,
    cancelAt,
    currentPeriodEnd,
  };
};

// DECISION (nie usuwaj tego komentarza):
// Email send is fire-and-forget AFTER the webhook tx commits — Stripe webhook
// needs <5s response; durability handled by FailedEmail table + EMAIL_DEAD_LETTERED
// audit. Returns a StripeWebhookEffect so the post-commit collector in
// pages/api/v1/webhooks/stripe/index.ts can schedule it AFTER $transaction
// commits — a rolled-back tx fires zero confirmation emails (D1 atomicity).
export const sendUpgradeConfirmationEmail = ({
  user,
  pricingPlanValue,
  validatedPlanId,
}: {
  user: ResolvedCheckoutUser;
  pricingPlanValue: PricingPlan;
  validatedPlanId: string;
}): StripeWebhookEffect | null => {
  if (!user.email) {
    return null;
  }

  const userEmail = user.email;
  return async () => {
    try {
      await sendTransactionalEmail(
        'upgrade-confirmation',
        { email: userEmail, id: user.id },
        APP_EVENTS.INFO.EMAIL.EMAIL_UPGRADE_CONFIRMATION_SENT,
        { planName: getPlanDisplayName(pricingPlanValue) },
        'email.upgrade.subject'
      );
    } catch (error: unknown) {
      reportIssueBackend({
        namespace: 'STRIPE_UPGRADE_CONFIRMATION_EMAIL_FAILED',
        message: error instanceof Error ? error.message : 'Email rejected',
        payload: { userId: user.id, plan: validatedPlanId },
        mode: 'error',
      });
    }
  };
};
