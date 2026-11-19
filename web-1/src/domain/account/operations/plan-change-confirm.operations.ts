import type Stripe from 'stripe';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  BillingPeriod,
  PlanChangeResponse,
} from '@kernel/domain/user-and-account/account-checkout.types';
import {
  isPreviewableSubscriptionStatus,
  pendingTargetPriceId,
  readOwnedNailfolioItem,
  readPreviewFigures,
  subscriptionChangeFingerprint,
  planChangePreviewParams,
  type PreviewFigures,
} from './plan-change-preview';
import type { PlanChangeQuote } from './plan-change-quote.store';
import {
  stale,
  stripeFailure,
  type PlanChangeFailure,
} from './plan-change-quote.operations';
import { mapLatestInvoiceToPlanChange } from './plan-change-invoice.map';
import type { PlanChangeLease } from './plan-change-lease';

const figuresMatch = (
  figures: PreviewFigures,
  quote: PlanChangeQuote
): boolean =>
  figures.amountDue === quote.amountDue &&
  figures.total === quote.total &&
  figures.currency === quote.currency &&
  figures.taxAmount === quote.taxAmount;

export const confirmQuotedUpdate_IO = async ({
  stripe,
  subscription,
  quoted,
  billingPeriod,
  stripePlanId,
  lease,
}: {
  stripe: Stripe;
  subscription: Stripe.Subscription;
  quoted: PlanChangeQuote;
  billingPeriod: BillingPeriod;
  stripePlanId: string;
  lease: PlanChangeLease;
}): Promise<OperationResult<PlanChangeResponse, PlanChangeFailure>> => {
  const item = readOwnedNailfolioItem(subscription, quoted.accountId);
  if (item == null) {
    return stripeFailure(
      'changePaidPlan:scope',
      'Subscription is not safely previewable'
    );
  }

  if (!isPreviewableSubscriptionStatus(subscription.status)) {
    return stale('changed');
  }
  const pendingPriceId = pendingTargetPriceId(subscription);
  const latest = subscription.latest_invoice;
  if (
    subscription.pending_update != null ||
    item.priceId === quoted.targetPriceId
  ) {
    const figures =
      latest != null && typeof latest !== 'string'
        ? readPreviewFigures(latest)
        : null;
    // Resume only the invoice this quote actually created or displayed. A new
    // preview cannot authorize an unrelated, more expensive pending SCA invoice.
    if (
      latest == null ||
      typeof latest === 'string' ||
      quoted.resultInvoiceId !== latest.id ||
      figures == null ||
      !figuresMatch(figures, quoted) ||
      (subscription.pending_update != null &&
        pendingPriceId !== quoted.targetPriceId)
    ) {
      return stale('changed');
    }
    return success(mapLatestInvoiceToPlanChange(latest));
  }
  if (
    pendingPriceId === undefined ||
    subscriptionChangeFingerprint(subscription) !== quoted.fingerprint
  ) {
    return stale('changed');
  }

  let invoice: Stripe.Invoice;
  try {
    invoice = await stripe.invoices.createPreview(
      planChangePreviewParams({
        subscriptionId: quoted.subscriptionId,
        itemId: item.id,
        priceId: quoted.targetPriceId,
        quantity: item.quantity,
        prorationDate: quoted.prorationDate,
      }),
      lease.options()
    );
  } catch (error: unknown) {
    return failure({
      type: 'ACCOUNT_STRIPE_ERROR',
      operation: 'changePaidPlan:repreview',
      stripeError: error instanceof Error ? error.message : String(error),
    });
  }
  const figures = readPreviewFigures(invoice);
  if (figures == null || !figuresMatch(figures, quoted)) {
    return stale('changed');
  }

  if (!(await lease.live())) {
    return stale('changed');
  }

  let updated: Stripe.Subscription;
  try {
    updated = await stripe.subscriptions.update(
      quoted.subscriptionId,
      {
        items: [
          {
            id: item.id,
            price: quoted.targetPriceId,
            quantity: item.quantity,
          },
        ],
        proration_behavior: 'always_invoice',
        proration_date: quoted.prorationDate,
        payment_behavior: 'pending_if_incomplete',
        metadata: { planId: stripePlanId, billingPeriod },
        expand: ['latest_invoice.confirmation_secret'],
      },
      { ...lease.options(), idempotencyKey: quoted.quoteId }
    );
  } catch (error: unknown) {
    return failure({
      type: 'ACCOUNT_STRIPE_ERROR',
      operation: 'changePaidPlan:update',
      stripeError: error instanceof Error ? error.message : String(error),
    });
  }
  if (
    updated.latest_invoice != null &&
    typeof updated.latest_invoice !== 'string'
  ) {
    quoted.resultInvoiceId = updated.latest_invoice.id;
  }
  if (updated.latest_invoice == null && quoted.amountDue > 0) {
    return success({ status: 'payment_failed', reason: 'invoice_missing' });
  }
  return success(mapLatestInvoiceToPlanChange(updated.latest_invoice));
};
