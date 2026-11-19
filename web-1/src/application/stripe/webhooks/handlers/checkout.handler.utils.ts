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
import {
  enqueueEmailOutboxTx,
  kickEmailOutbox,
} from '@app/email-handler/outbox/email-outbox';
import { DB_CLIENT } from '@app/db/db.client';
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

// DECISION: `effects[]` is passed in by the caller (handleCheckoutCompleted) rather than returned
// alongside the resolved user, so the validation helpers can queue post-commit alert effects
// without changing their `Promise<X | null>` shape. See
// web-1/src/application/stripe/webhooks/stripe-effects.types.ts (effects fire only post-commit).
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

  // DECISION: fallback on the already-null branch. A genuine session carries `session.customer`
  // (= `stylist_account.stripe_customer_id`, @unique), so retry via it before the last-resort
  // alert. It is DELIBERATELY the only fallback key: the per-account advisory lock is keyed on
  // `session.customer` (checkout.handler.ts), so resolving through it keeps account.customer ===
  // lock key. A `metadata.accountId` fallback could overwrite the stored customer id and let two
  // webhooks lock different keys while mutating one row. Foreign-project sessions are not in our
  // DB; isOutOfScopeSession handles those.
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

  // `extractPlanIdFromCheckout` calls Stripe ONLY when `price.product` arrives as a string id.
  // Here it does not: the session is already expanded with `line_items.data.price.product`
  // (`CHECKOUT_SESSION_EXPAND`), either in the pre-transaction prefetch or by the router's
  // fallback expand (which has its own `d2f1-allow`). Trimming `CHECKOUT_SESSION_EXPAND` breaks this.
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
 * When the account already has a different subscription id, return a post-commit
 * effect that cancels the old one outside the webhook transaction. Null if there
 * is no duplicate.
 * DECISION: the old id is closed over before return, so the cancel still targets it
 * after updateAccountPlanStatus overwrites the row. Only the collector in
 * pages/api/v1/webhooks/stripe/index.ts calls runAfterResponse.
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
  // it would leave the account with no subscription at all.
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

// DECISION: see web-1/src/application/email-handler/outbox/email-outbox.store.ts. The upgrade
// confirmation is a durable intent written in the checkout transaction (one per checkout session),
// sent after commit by the returned kick effect and, after a crash, by the `email-outbox` job.
export const queueUpgradeConfirmationEmail = async ({
  user,
  pricingPlanValue,
  sessionId,
  tx,
}: {
  user: ResolvedCheckoutUser;
  pricingPlanValue: PricingPlan;
  sessionId: string;
  tx?: Prisma.TransactionClient;
}): Promise<StripeWebhookEffect | null> => {
  if (!user.email) {
    return null;
  }
  const queuedId = await enqueueEmailOutboxTx(tx ?? DB_CLIENT.use, {
    userId: user.id,
    accountId: user.stylist_account.account_id,
    ruleId: 'upgrade-confirmation',
    templateId: 'upgrade-confirmation',
    occurrence: `checkout:${sessionId}`,
    subjectKey: 'email.upgrade.subject',
    infoEvent: APP_EVENTS.INFO.EMAIL.EMAIL_UPGRADE_CONFIRMATION_SENT,
    vars: { planName: getPlanDisplayName(pricingPlanValue) },
  });
  return queuedId ? kickEmailOutbox([queuedId]) : null;
};
