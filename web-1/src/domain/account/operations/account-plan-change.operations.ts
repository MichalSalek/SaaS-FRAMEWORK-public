import { confirmQuotedUpdate_IO } from './plan-change-confirm.operations';
import crypto from 'crypto';
import type Stripe from 'stripe';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  BillingPeriod,
  PlanChangeResponse,
} from '@kernel/domain/user-and-account/account-checkout.types';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import { getStripe } from '@app/stripe/adapters/stripe.adapter';
import { isBillingCurrency } from '@kernel/domain/localization/country.config';
import { resolveCheckoutPrice_IO } from '@app/stripe/price-resolver.operations';
import { getPlanIdFromPricingPlanValue } from '@app/stripe/stripe.config';
import { mapLatestInvoiceToPlanChange } from './plan-change-invoice.map';
import {
  loadOwnedAccount_IO,
  stale,
  type PlanChangeFailure,
} from './plan-change-quote.operations';
import {
  readPlanChangeQuote,
  type PlanChangeQuote,
} from './plan-change-quote.store';
import {
  withPlanChangeLease_IO,
  type PlanChangeLease,
} from './plan-change-lease';

/**
 * Paid-plan switch via pending_if_incomplete: item-price webhooks own access.
 * DECISION: a quote binds the shown amount, proration date and idempotency key.
 * Older clients retain the unquoted flow during rollout. (owner)
 * Test: account-plan-change.quote.test.ts and account-plan-change.replay.test.ts
 * (scope, stale price, retries and pending SCA; not concurrent external changes).
 */
const changePaidPlanUnderLease_IO = async ({
  userId,
  targetPlanId,
  billingPeriod,
  quoteId,
  lease,
}: {
  userId: string;
  targetPlanId: PricingPlan;
  billingPeriod: BillingPeriod;
  quoteId?: string;
  lease: PlanChangeLease;
}): Promise<OperationResult<PlanChangeResponse, PlanChangeFailure>> => {
  const owned = await loadOwnedAccount_IO(userId, 'changePaidPlan:fetchUser');
  if (!owned.success) {
    return owned;
  }
  const { accountId, subscriptionId } = owned.data;
  if (accountId !== lease.accountId) {
    return stale('changed');
  }

  let quoted: PlanChangeQuote | null = null;
  if (quoteId !== undefined) {
    const loaded = readPlanChangeQuote(quoteId);
    if (
      loaded == null ||
      loaded.accountId !== accountId ||
      loaded.targetPlanId !== targetPlanId ||
      loaded.billingPeriod !== billingPeriod
    ) {
      return stale('invalid');
    }
    if (loaded.expiresAt <= Date.now()) {
      return stale('expired');
    }
    if (loaded.subscriptionId !== subscriptionId) {
      return stale('changed');
    }
    quoted = loaded;
  }

  const stripe = getStripe();
  let subscription: Stripe.Subscription;
  try {
    // Expand latest_invoice.confirmation_secret on the first retrieve. The no-op
    // guard below needs it to see an abandoned SCA on the previous change's invoice.
    subscription = await stripe.subscriptions.retrieve(
      subscriptionId,
      {
        expand:
          quoted == null
            ? ['latest_invoice.confirmation_secret']
            : [
                'items.data.price.product',
                'latest_invoice.confirmation_secret',
              ],
      },
      lease.options()
    );
  } catch (error: unknown) {
    return failure({
      type: 'ACCOUNT_STRIPE_ERROR',
      operation: 'changePaidPlan:retrieve',
      stripeError: error instanceof Error ? error.message : String(error),
    });
  }

  const currentCurrency = subscription.items.data[0]?.price?.currency;
  if (!currentCurrency || !isBillingCurrency(currentCurrency)) {
    return failure({
      type: 'ACCOUNT_STRIPE_ERROR',
      operation: 'changePaidPlan:currency',
      stripeError: 'Unsupported subscription currency',
    });
  }
  const priceResult = await resolveCheckoutPrice_IO({
    planId: targetPlanId,
    billingPeriod,
    currency: currentCurrency,
  });
  if (!priceResult.success) {
    return failure(priceResult.error);
  }
  const resolvedPriceId = priceResult.data.priceId;
  const stripePlanId = getPlanIdFromPricingPlanValue(targetPlanId);
  if (
    quoted &&
    (quoted.targetPriceId !== resolvedPriceId ||
      quoted.currency !== currentCurrency)
  ) {
    return stale('changed');
  }

  if (quoted != null) {
    return confirmQuotedUpdate_IO({
      stripe,
      subscription,
      quoted,
      billingPeriod,
      stripePlanId,
      lease,
    });
  }

  const currentItem = subscription.items.data[0];
  if (currentItem == null) {
    return failure({
      type: 'ACCOUNT_STRIPE_ERROR',
      operation: 'changePaidPlan:retrieve',
      stripeError: 'Subscription has no line items to update',
    });
  }

  // === GUARD: pending_update (pending_if_incomplete trzyma cene w pending do oplaty) ===
  // DECISION: with 'pending_if_incomplete' the price change waits in subscription.pending_update and
  // currentItem keeps the OLD price, so "currentItem.price === target" does not detect an in-flight
  // change. Pending to the same target = double submit: re-surface the existing confirmation_secret
  // and do NOT update again (Stripe would void the invoice and break the user's 3DS). Pending to
  // another plan = supersede (Stripe voids the old pending). No pending and already on target =
  // applied or a no-op: map latest_invoice.
  const pendingUpdate = subscription.pending_update;
  if (pendingUpdate != null) {
    const pendingPrice = pendingUpdate.subscription_items?.[0]?.price;
    const pendingPriceId =
      typeof pendingPrice === 'string'
        ? pendingPrice
        : (pendingPrice?.id ?? null);
    if (pendingPriceId === resolvedPriceId) {
      // Double-submit na ten sam target -> re-surface istniejacy stan, BEZ drugiego update.
      return success(mapLatestInvoiceToPlanChange(subscription.latest_invoice));
    }
    // Inny target -> supersede: kontynuuj do update nizej (Stripe voiduje poprzedni pending).
  } else if (currentItem.price?.id === resolvedPriceId) {
    // Brak pending, juz na docelowej cenie -> zaaplikowane lub no-op (mapuj fakture).
    return success(mapLatestInvoiceToPlanChange(subscription.latest_invoice));
  }

  // === UPDATE: pending_if_incomplete + always_invoice ===
  // DECISION: 'always_invoice' forces an immediate proration invoice ('create_prorations' would
  // defer it to the next period, so no SCA would happen for a same-interval change).
  // 'pending_if_incomplete' keeps the change pending until paid, so an abandoned 3DS never switches
  // the plan; the DB plan is set by the webhook from the ITEM PRICE (extractPlanIdFromSubscription),
  // not from metadata.planId, which applies immediately. On the Basil API SCA goes through
  // latest_invoice.confirmation_secret; do not go back to expanding payment_intent. The
  // idempotencyKey is random per invocation: a deterministic key would make A->B->A within 24h
  // replay Stripe's cached old result.
  const idempotencyKey = crypto.randomUUID();
  if (!(await lease.live())) {
    return stale('changed');
  }
  let updated: Stripe.Subscription;
  try {
    updated = await stripe.subscriptions.update(
      subscriptionId,
      {
        items: [
          {
            id: currentItem.id,
            price: resolvedPriceId,
            ...(currentItem.quantity != null
              ? { quantity: currentItem.quantity }
              : {}),
          },
        ],
        proration_behavior: 'always_invoice',
        payment_behavior: 'pending_if_incomplete',
        metadata: { planId: stripePlanId, billingPeriod },
        expand: ['latest_invoice.confirmation_secret'],
      },
      { ...lease.options(), idempotencyKey }
    );
  } catch (error: unknown) {
    return failure({
      type: 'ACCOUNT_STRIPE_ERROR',
      operation: 'changePaidPlan:update',
      stripeError: error instanceof Error ? error.message : String(error),
    });
  }

  return success(mapLatestInvoiceToPlanChange(updated.latest_invoice));
};

export const changePaidPlan_IO = async (input: {
  userId: string;
  targetPlanId: PricingPlan;
  billingPeriod: BillingPeriod;
  quoteId?: string;
}): Promise<OperationResult<PlanChangeResponse, PlanChangeFailure>> => {
  const owned = await loadOwnedAccount_IO(
    input.userId,
    'changePaidPlan:fetchUser'
  );
  if (!owned.success) {
    return owned;
  }
  return withPlanChangeLease_IO(owned.data.accountId, lease =>
    changePaidPlanUnderLease_IO({ ...input, lease })
  );
};
