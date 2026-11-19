import type Stripe from 'stripe';
import type {
  PendingSubscriptionPayment,
  SubscriptionDiscountSummary,
} from '@kernel/models/session/session.dto';
import { isStripeHostedInvoiceUrl } from '@kernel/domain/stripe/hosted-invoice-url';

type Invoice = Pick<
  Stripe.Invoice,
  | 'id'
  | 'status'
  | 'amount_remaining'
  | 'currency'
  | 'hosted_invoice_url'
  | 'parent'
>;
type Subscription = {
  id: string;
  status: Stripe.Subscription.Status;
  pending_update?: { expires_at: number } | null;
  latest_invoice?: string | Invoice | null;
};

/** A read cannot create or retry a payment. Recovery always opens the existing owned invoice. */
export function pendingSubscriptionPayment(
  subscription: Subscription,
  now = Date.now()
): PendingSubscriptionPayment | null {
  if (
    !['active', 'trialing', 'past_due', 'incomplete'].includes(
      subscription.status
    )
  ) {
    return null;
  }
  const invoice = subscription.latest_invoice;
  if (
    invoice == null ||
    typeof invoice === 'string' ||
    invoice.status !== 'open' ||
    !Number.isInteger(invoice.amount_remaining) ||
    invoice.amount_remaining <= 0 ||
    !/^[a-z]{3}$/i.test(invoice.currency) ||
    !invoice.hosted_invoice_url ||
    !isStripeHostedInvoiceUrl(invoice.hosted_invoice_url)
  ) {
    return null;
  }
  const parent = invoice.parent?.subscription_details?.subscription;
  const parentId = typeof parent === 'string' ? parent : parent?.id;
  if (parentId !== subscription.id) {
    return null;
  }
  const expiry = subscription.pending_update?.expires_at;
  if (
    expiry !== undefined &&
    (!Number.isSafeInteger(expiry) ||
      !Number.isFinite(new Date(expiry * 1000).getTime()) ||
      expiry * 1000 <= now)
  ) {
    return null;
  }
  return {
    reason:
      subscription.pending_update != null
        ? 'plan_change'
        : subscription.status === 'incomplete'
          ? 'subscription_start'
          : 'invoice',
    invoiceId: invoice.id,
    url: invoice.hosted_invoice_url,
    amountRemaining: invoice.amount_remaining,
    currency: invoice.currency,
    expiresAt:
      expiry === undefined ? null : new Date(expiry * 1000).toISOString(),
  };
}

export function subscriptionDiscounts(
  discounts: Stripe.Subscription['discounts'],
  now = Date.now(),
  productId?: string,
  subscriptionCurrency?: string
): SubscriptionDiscountSummary[] {
  return discounts.flatMap(discount => {
    if (
      typeof discount === 'string' ||
      (discount.end != null && discount.end * 1000 <= now)
    ) {
      return [];
    }
    const coupon = discount.source?.coupon;
    if (coupon == null || typeof coupon === 'string') {
      return [];
    }
    if (
      (coupon.applies_to?.products.length ?? 0) > 0 &&
      (!productId || !coupon.applies_to?.products.includes(productId))
    ) {
      return [];
    }
    const percentOff =
      typeof coupon.percent_off === 'number' &&
      coupon.percent_off > 0 &&
      coupon.percent_off <= 100
        ? coupon.percent_off
        : null;
    const currency =
      typeof subscriptionCurrency === 'string' &&
      /^[a-z]{3}$/i.test(subscriptionCurrency)
        ? subscriptionCurrency.toLowerCase()
        : null;
    const selectedAmount =
      currency === null
        ? null
        : coupon.currency?.toLowerCase() === currency
          ? coupon.amount_off
          : coupon.currency_options?.[currency]?.amount_off;
    const amountOff =
      typeof selectedAmount === 'number' &&
      Number.isSafeInteger(selectedAmount) &&
      selectedAmount > 0
        ? selectedAmount
        : null;
    if (percentOff === null && (amountOff === null || currency === null)) {
      return [];
    }
    if (!['forever', 'once', 'repeating'].includes(coupon.duration)) {
      return [];
    }
    if (
      discount.end != null &&
      !Number.isFinite(new Date(discount.end * 1000).getTime())
    ) {
      return [];
    }
    return [
      {
        name: coupon.name,
        percentOff,
        amountOff,
        currency: percentOff === null ? currency : coupon.currency,
        duration: coupon.duration,
        endsAt:
          discount.end == null
            ? null
            : new Date(discount.end * 1000).toISOString(),
      },
    ];
  });
}
