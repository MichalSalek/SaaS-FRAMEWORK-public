import type Stripe from 'stripe';
import { isScopedToNailfolio } from '@app/stripe/stripe.config';

const PREVIEWABLE_STATUSES = new Set(['active', 'trialing', 'past_due']);

export type PreviewFigures = {
  amountDue: number;
  total: number;
  taxAmount: number | null;
  currency: string;
};

export type OwnedPlanItem = {
  id: string;
  quantity: number;
  priceId: string;
  currentPeriodEnd: number;
};

const discountIds = (
  discounts: Array<string | { id?: string }>
): string[] | null => {
  const ids: string[] = [];
  for (const discount of discounts) {
    const id = typeof discount === 'string' ? discount : discount.id;
    if (typeof id !== 'string' || id.length === 0) {
      return null;
    }
    ids.push(id);
  }
  ids.sort();
  return ids;
};

const taxRateIds = (
  item: Stripe.SubscriptionItem,
  subscription: Stripe.Subscription
): string[] | null => {
  // Stripe inherits subscription defaults when the item has no explicit rates.
  const itemRates = item.tax_rates;
  const rates =
    itemRates == null || (Array.isArray(itemRates) && itemRates.length === 0)
      ? (subscription.default_tax_rates ?? [])
      : itemRates;
  if (rates == null) {
    return [];
  }
  if (!Array.isArray(rates)) {
    return null;
  }
  const ids: string[] = [];
  for (const rate of rates) {
    const id = typeof rate === 'string' ? rate : rate.id;
    if (typeof id !== 'string' || id.length === 0) {
      return null;
    }
    ids.push(id);
  }
  ids.sort();
  return ids;
};

/**
 * Price id held in `pending_update`, `null` when nothing is pending, `undefined`
 * when the pending payload cannot be read safely.
 */
export const pendingTargetPriceId = (
  subscription: Stripe.Subscription
): string | null | undefined => {
  if (subscription.pending_update == null) {
    return null;
  }
  const price = subscription.pending_update.subscription_items?.[0]?.price as
    string | { id?: string } | undefined;
  if (typeof price === 'string' && price.length > 0) {
    return price;
  }
  if (
    price != null &&
    typeof price === 'object' &&
    typeof price.id === 'string' &&
    price.id.length > 0
  ) {
    return price.id;
  }
  return undefined;
};

export const isPreviewableSubscriptionStatus = (
  status: string | null | undefined
): boolean => status != null && PREVIEWABLE_STATUSES.has(status);

/**
 * Single Nailfolio item owned by this account. Anything else is not safe to
 * price: a foreign product, a missing owner stamp, or more than one item.
 */
export const readOwnedNailfolioItem = (
  subscription: Stripe.Subscription,
  accountId: string
): OwnedPlanItem | null => {
  if (subscription.metadata?.accountId !== accountId) {
    return null;
  }
  const items = subscription.items?.data;
  if (items == null || items.length !== 1) {
    return null;
  }
  const item = items[0];
  if (item == null || item.id.length === 0) {
    return null;
  }
  const price = item.price as Stripe.Price | string | undefined;
  if (price == null || typeof price === 'string' || price.id.length === 0) {
    return null;
  }
  const product = price.product;
  if (product == null || typeof product === 'string' || product.deleted) {
    return null;
  }
  if (!isScopedToNailfolio(product.metadata.planId)) {
    return null;
  }
  if (
    typeof item.quantity !== 'number' ||
    !Number.isInteger(item.quantity) ||
    item.quantity < 1
  ) {
    return null;
  }
  return {
    id: item.id,
    quantity: item.quantity,
    priceId: price.id,
    currentPeriodEnd: item.current_period_end,
  };
};

/**
 * DECISION: the fingerprint is the subscription context the quoted amount was
 * calculated against. A later confirm that does not match asks for a new quote
 * instead of charging a refreshed price.
 */
export const subscriptionChangeFingerprint = (
  subscription: Stripe.Subscription
): string | null => {
  const items = subscription.items?.data;
  if (items == null || items.length !== 1) {
    return null;
  }
  const item = items[0];
  if (item == null) {
    return null;
  }
  const price = item.price as Stripe.Price | string | undefined;
  const priceId = typeof price === 'string' ? price : price?.id;
  if (typeof priceId !== 'string' || priceId.length === 0) {
    return null;
  }
  if (
    typeof item.quantity !== 'number' ||
    !Number.isInteger(item.quantity) ||
    !Number.isInteger(item.current_period_start) ||
    !Number.isInteger(item.current_period_end)
  ) {
    return null;
  }
  if (
    !Array.isArray(item.discounts) ||
    !Array.isArray(subscription.discounts) ||
    typeof subscription.status !== 'string' ||
    typeof subscription.cancel_at_period_end !== 'boolean'
  ) {
    return null;
  }
  if (
    subscription.trial_end != null &&
    !Number.isInteger(subscription.trial_end)
  ) {
    return null;
  }
  if (
    subscription.cancel_at != null &&
    !Number.isInteger(subscription.cancel_at)
  ) {
    return null;
  }
  const itemDiscounts = discountIds(item.discounts);
  const subscriptionDiscounts = discountIds(subscription.discounts);
  const taxes = taxRateIds(item, subscription);
  const pendingPriceId = pendingTargetPriceId(subscription);
  if (
    itemDiscounts == null ||
    subscriptionDiscounts == null ||
    taxes == null ||
    pendingPriceId === undefined
  ) {
    return null;
  }
  return JSON.stringify({
    status: subscription.status,
    priceId,
    quantity: item.quantity,
    itemDiscounts,
    discounts: subscriptionDiscounts,
    taxIds: taxes,
    automaticTaxEnabled: subscription.automatic_tax?.enabled ?? false,
    trialEnd: subscription.trial_end ?? null,
    cancelAt: subscription.cancel_at ?? null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    periodStart: item.current_period_start,
    periodEnd: item.current_period_end,
    pendingPriceId,
  });
};

export const planChangePreviewParams = (input: {
  subscriptionId: string;
  itemId: string;
  priceId: string;
  quantity: number;
  prorationDate: number;
}): Stripe.InvoiceCreatePreviewParams => ({
  subscription: input.subscriptionId,
  subscription_details: {
    items: [
      {
        id: input.itemId,
        price: input.priceId,
        quantity: input.quantity,
      },
    ],
    proration_behavior: 'always_invoice',
    proration_date: input.prorationDate,
  },
});

/**
 * Stripe's preview is the only source of the amount. A missing or non-integer
 * figure is unusable: callers must fail, never substitute 0.
 */
export const readPreviewFigures = (invoice: {
  amount_due?: unknown;
  total?: unknown;
  currency?: unknown;
  total_taxes?: Array<{ amount?: unknown }> | null;
}): PreviewFigures | null => {
  const {
    amount_due: amountDue,
    total,
    currency,
    total_taxes: totalTaxes,
  } = invoice;
  if (
    typeof amountDue !== 'number' ||
    !Number.isInteger(amountDue) ||
    amountDue < 0
  ) {
    return null;
  }
  if (typeof total !== 'number' || !Number.isInteger(total)) {
    return null;
  }
  if (typeof currency !== 'string' || currency.length === 0) {
    return null;
  }
  if (totalTaxes == null) {
    return { amountDue, total, currency, taxAmount: null };
  }
  if (!Array.isArray(totalTaxes)) {
    return null;
  }
  let taxAmount = 0;
  for (const tax of totalTaxes) {
    if (typeof tax.amount !== 'number' || !Number.isInteger(tax.amount)) {
      return null;
    }
    taxAmount += tax.amount;
  }
  return { amountDue, total, currency, taxAmount };
};

export const cancelAtIso = (
  subscription: Stripe.Subscription,
  periodEnd: number
): string | null => {
  if (typeof subscription.cancel_at === 'number') {
    return new Date(subscription.cancel_at * 1000).toISOString();
  }
  if (
    subscription.cancel_at_period_end === true &&
    Number.isInteger(periodEnd)
  ) {
    return new Date(periodEnd * 1000).toISOString();
  }
  return null;
};
