import type Stripe from 'stripe';
import { DB_CLIENT } from '@app/db/db.client';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  AccountStripeError,
  CheckoutPlanNotFoundError,
  CheckoutPriceResolveError,
  PlanChangeNoSubscriptionError,
  PlanChangeQuoteStaleError,
} from '@kernel/domain/user-and-account/account-errors.types';
import type {
  AccountNotFoundError,
  DatabaseError,
} from '@kernel/application/common-errors.types';
import type {
  BillingPeriod,
  PlanChangePreviewResponse,
} from '@kernel/domain/user-and-account/account-checkout.types';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { getStripe } from '@app/stripe/adapters/stripe.adapter';
import { isBillingCurrency } from '@kernel/domain/localization/country.config';
import { resolveCheckoutPrice_IO } from '@app/stripe/price-resolver.operations';
import {
  cancelAtIso,
  isPreviewableSubscriptionStatus,
  pendingTargetPriceId,
  planChangePreviewParams,
  readOwnedNailfolioItem,
  readPreviewFigures,
  subscriptionChangeFingerprint,
} from './plan-change-preview';
import { savePlanChangeQuote } from './plan-change-quote.store';
import { readPlanChangeTerms } from './plan-change-terms';

export type PlanChangeFailure =
  | PlanChangeNoSubscriptionError
  | PlanChangeQuoteStaleError
  | CheckoutPlanNotFoundError
  | CheckoutPriceResolveError
  | AccountStripeError
  | AccountNotFoundError
  | DatabaseError;

export const stripeFailure = (
  operation: string,
  stripeError: string
): OperationResult<never, AccountStripeError> =>
  failure({
    type: 'ACCOUNT_STRIPE_ERROR',
    operation,
    stripeError,
  });

export const stale = (
  reason: PlanChangeQuoteStaleError['reason']
): OperationResult<never, PlanChangeQuoteStaleError> =>
  failure({ type: 'PLAN_CHANGE_QUOTE_STALE', reason });

export const loadOwnedAccount_IO = async (
  userId: string,
  operation: string
): Promise<
  OperationResult<
    { accountId: string; subscriptionId: string },
    PlanChangeNoSubscriptionError | AccountNotFoundError | DatabaseError
  >
> => {
  let user;
  try {
    user = await DB_CLIENT.use.user.findUnique({
      where: { id: userId },
      select: {
        stylist_account: {
          select: {
            account_id: true,
            subscription_id: true,
          },
        },
      },
    });
  } catch (error) {
    return databaseFailure(operation, error);
  }
  if (!user?.stylist_account) {
    return failure({ type: 'ACCOUNT_NOT_FOUND', accountId: userId });
  }
  const { account_id: accountId, subscription_id: subscriptionId } =
    user.stylist_account;
  if (subscriptionId == null) {
    return failure({ type: 'PLAN_CHANGE_NO_SUBSCRIPTION', accountId });
  }
  return success({ accountId, subscriptionId });
};

/**
 * Read-only price of a paid-plan or billing-period switch. Stripe's preview is
 * not persisted and this function never updates the subscription.
 */
export const previewPaidPlanChange_IO = async ({
  userId,
  targetPlanId,
  billingPeriod,
}: {
  userId: string;
  targetPlanId: PricingPlan;
  billingPeriod: BillingPeriod;
}): Promise<
  OperationResult<
    PlanChangePreviewResponse,
    | PlanChangeNoSubscriptionError
    | CheckoutPlanNotFoundError
    | CheckoutPriceResolveError
    | AccountStripeError
    | AccountNotFoundError
    | DatabaseError
    | PlanChangeQuoteStaleError
  >
> => {
  const owned = await loadOwnedAccount_IO(
    userId,
    'previewPaidPlanChange:fetchUser'
  );
  if (!owned.success) {
    return owned;
  }
  const { accountId, subscriptionId } = owned.data;

  const stripe = getStripe();
  let subscription: Stripe.Subscription;
  try {
    subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: [
        'items.data.price.product',
        'latest_invoice.confirmation_secret',
      ],
    });
  } catch (error: unknown) {
    return failure({
      type: 'ACCOUNT_STRIPE_ERROR',
      operation: 'previewPaidPlanChange:retrieve',
      stripeError: error instanceof Error ? error.message : String(error),
    });
  }

  const currentCurrency = subscription.items.data[0]?.price?.currency;
  if (!currentCurrency || !isBillingCurrency(currentCurrency)) {
    return stripeFailure(
      'previewPaidPlanChange:currency',
      'Unsupported subscription currency'
    );
  }
  const priceResult = await resolveCheckoutPrice_IO({
    planId: targetPlanId,
    billingPeriod,
    currency: currentCurrency,
  });
  if (!priceResult.success) {
    return failure(priceResult.error);
  }

  if (!isPreviewableSubscriptionStatus(subscription.status)) {
    return stripeFailure(
      'previewPaidPlanChange:scope',
      'Subscription is not safely previewable'
    );
  }
  const item = readOwnedNailfolioItem(subscription, accountId);
  const fingerprint = subscriptionChangeFingerprint(subscription);
  if (item == null || fingerprint == null) {
    return stripeFailure(
      'previewPaidPlanChange:scope',
      'Subscription is not safely previewable'
    );
  }
  const pendingPriceId = pendingTargetPriceId(subscription);
  const pendingInvoice =
    subscription.pending_update != null ? subscription.latest_invoice : null;
  if (
    pendingPriceId === undefined ||
    (pendingPriceId !== null && pendingPriceId !== priceResult.data.priceId) ||
    (subscription.pending_update != null &&
      (pendingInvoice == null || typeof pendingInvoice === 'string'))
  ) {
    return stripeFailure(
      'previewPaidPlanChange:pending',
      'Pending change requires a readable invoice for the same target'
    );
  }
  if (
    subscription.pending_update == null &&
    item.priceId === priceResult.data.priceId
  ) {
    return stripeFailure(
      'previewPaidPlanChange:noChange',
      'Subscription already uses this price'
    );
  }
  // A period switch can move a period-end cancellation. Keep its agreed date by
  // refusing this combination until the owner explicitly resumes in the portal.
  if (
    (subscription.cancel_at_period_end || subscription.cancel_at != null) &&
    item.priceId !== priceResult.data.priceId &&
    subscription.items.data[0]?.price.recurring?.interval !== billingPeriod
  ) {
    return stale('canceling');
  }
  const prorationDate = Math.floor(Date.now() / 1000);
  let invoice: Stripe.Invoice;
  try {
    // DECISION: preview only. No trial_end, no cancel_at, no invoice create.
    // The same proration_date is stored and replayed on the quoted update.
    invoice =
      pendingInvoice != null && typeof pendingInvoice !== 'string'
        ? pendingInvoice
        : await stripe.invoices.createPreview(
            planChangePreviewParams({
              subscriptionId,
              itemId: item.id,
              priceId: priceResult.data.priceId,
              quantity: item.quantity,
              prorationDate,
            })
          );
  } catch (error: unknown) {
    return failure({
      type: 'ACCOUNT_STRIPE_ERROR',
      operation: 'previewPaidPlanChange:preview',
      stripeError: error instanceof Error ? error.message : String(error),
    });
  }

  const figures = readPreviewFigures(invoice);
  if (figures == null || figures.currency !== currentCurrency) {
    return stripeFailure(
      'previewPaidPlanChange:preview',
      'Preview amounts are unavailable'
    );
  }

  let targetPrice: Stripe.Price;
  try {
    targetPrice = await stripe.prices.retrieve(priceResult.data.priceId);
  } catch (error: unknown) {
    return stripeFailure(
      'previewPaidPlanChange:targetPrice',
      error instanceof Error ? error.message : String(error)
    );
  }
  const cancelAt = cancelAtIso(subscription, item.currentPeriodEnd);
  const terms = readPlanChangeTerms({
    targetPrice,
    targetPriceId: priceResult.data.priceId,
    currency: currentCurrency,
    quantity: item.quantity,
    status: subscription.status,
    trialEnd: subscription.trial_end,
    currentPeriodEnd: item.currentPeriodEnd,
    currentInterval: subscription.items.data[0]?.price.recurring?.interval,
    billingPeriod,
    invoice,
    cancelAt,
    now: prorationDate,
  });
  if (terms == null) {
    return stripeFailure(
      'previewPaidPlanChange:targetPrice',
      'Target catalog price is unavailable or unsupported'
    );
  }
  const quote = savePlanChangeQuote({
    accountId,
    subscriptionId,
    targetPlanId,
    targetPriceId: priceResult.data.priceId,
    billingPeriod,
    fingerprint,
    ...(pendingInvoice != null && typeof pendingInvoice !== 'string'
      ? { resultInvoiceId: pendingInvoice.id }
      : {}),
    prorationDate,
    amountDue: figures.amountDue,
    total: figures.total,
    taxAmount: figures.taxAmount,
    currency: figures.currency,
  });

  return success({
    quoteId: quote.quoteId,
    expiresAt: new Date(quote.expiresAt).toISOString(),
    amountDue: figures.amountDue,
    total: figures.total,
    taxAmount: figures.taxAmount,
    currency: figures.currency,
    billingPeriod,
    ...terms,
    cancelAt,
  });
};
