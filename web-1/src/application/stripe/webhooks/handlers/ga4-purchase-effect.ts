import type Stripe from 'stripe';
import { STRIPE_PROJECT_ID } from '@app/stripe/stripe.types';
import type { StripeWebhookEffect } from '@app/stripe/webhooks/stripe-effects.types';
import { sendGA4Purchase } from '@app/analytics/ga4-measurement';

export const buildGA4PurchaseEffect = (
  invoice: Stripe.Invoice
): StripeWebhookEffect | null => {
  const subscriptionDetails =
    invoice.parent?.type === 'subscription_details'
      ? invoice.parent.subscription_details
      : null;
  const metadata = subscriptionDetails?.metadata ?? null;

  if (!metadata || metadata.projectId !== STRIPE_PROJECT_ID) {
    return null;
  }

  const amountPaid = invoice.amount_paid;
  const netValue = invoice.total_excluding_tax;

  if (
    amountPaid <= 0 ||
    netValue === null ||
    amountPaid !== invoice.amount_due
  ) {
    return null;
  }

  const currency = invoice.currency.toUpperCase();
  const tax = Math.max(0, amountPaid - netValue);
  const transactionId = invoice.id;

  if (!transactionId) {
    return null;
  }

  const gaClientId = metadata.gaClientId;
  const customerId =
    typeof invoice.customer === 'string'
      ? invoice.customer
      : (invoice.customer?.id ?? undefined);

  return async () => {
    await sendGA4Purchase({
      transactionId,
      // PLN, EUR and USD all use 100 minor units per major unit.
      value: netValue / 100,
      tax: tax / 100,
      currency,
      planId: metadata.planId ?? 'UNKNOWN',
      billingPeriod: metadata.billingPeriod ?? 'unknown',
      billingReason: invoice.billing_reason ?? 'unknown',
      ...(gaClientId ? { clientId: gaClientId } : {}),
      ...(customerId ? { customerId } : {}),
    });
  };
};
