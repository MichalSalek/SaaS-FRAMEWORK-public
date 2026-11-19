import {
  pendingSubscriptionPayment,
  subscriptionDiscounts,
} from './subscription-billing.details';
import { createCache } from '@app/cache/cache.utils';
import {
  SUBSCRIPTION_BILLING_CACHE_TTL_MS,
  SUBSCRIPTION_BILLING_REQUEST_TIMEOUT_MS,
} from './subscription-billing.config';
import type { SubscriptionBillingSummary } from '@kernel/models/session/session.dto';
import { getStripe } from './adapters/stripe.adapter';
import { isScopedToNailfolio } from './stripe.config';
import { VALID_PAID_PLAN_IDS } from '@kernel/domain/stripe/stripe.config';
import type Stripe from 'stripe';

type ScopedSubscription =
  | {
      kind: 'ok';
      stripe: Stripe;
      subscription: Stripe.Subscription;
      item: Stripe.SubscriptionItem;
      planId: string;
    }
  | { kind: 'invalid' | 'unavailable'; reason: string };

type RenewalRead =
  | {
      kind: 'available';
      amountMinor: number;
      currency: string;
      nextChargeAt: string;
      planId: string;
    }
  | { kind: 'not_renewing' | 'unavailable' | 'invalid'; reason: string };

async function loadScopedSubscription(
  subscriptionId: string,
  accountId: string,
  expandDiscountCurrencies = false
): Promise<ScopedSubscription> {
  try {
    const stripe = getStripe();
    const subscription = await stripe.subscriptions.retrieve(
      subscriptionId,
      {
        expand: [
          'items.data.price.product',
          'latest_invoice',
          'discounts.source.coupon',
          ...(expandDiscountCurrencies
            ? ['discounts.source.coupon.currency_options']
            : []),
        ],
      },
      { timeout: SUBSCRIPTION_BILLING_REQUEST_TIMEOUT_MS, maxNetworkRetries: 0 }
    );
    const item = subscription.items.data[0];
    const product = item?.price.product;
    if (
      subscription.items.data.length !== 1 ||
      item == null ||
      product == null ||
      typeof product === 'string' ||
      product.deleted ||
      typeof product.metadata.planId !== 'string' ||
      !isScopedToNailfolio(product.metadata.planId) ||
      subscription.metadata.accountId !== accountId
    ) {
      return { kind: 'invalid', reason: 'subscription_scope' };
    }
    return {
      kind: 'ok',
      stripe,
      subscription,
      item,
      planId: product.metadata.planId,
    };
  } catch (error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'resource_missing'
    ) {
      return { kind: 'invalid', reason: 'subscription_missing' };
    }
    return { kind: 'unavailable', reason: 'subscription_read_failed' };
  }
}

const previewOptions = {
  timeout: SUBSCRIPTION_BILLING_REQUEST_TIMEOUT_MS,
  maxNetworkRetries: 0,
} as const;

const loadInvoicePreview = (stripe: Stripe, subscriptionId: string) =>
  stripe.invoices.createPreview(
    { subscription: subscriptionId },
    previewOptions
  );

/** Fresh, read-only renewal quote; never use the UI's short-lived cache. */
export async function readSubscriptionRenewal_IO(
  subscriptionId: string | null,
  accountId: string,
  window: { start: Date; end: Date }
): Promise<RenewalRead> {
  if (subscriptionId == null) {
    return { kind: 'unavailable', reason: 'subscription_id_missing' };
  }
  const loaded = await loadScopedSubscription(subscriptionId, accountId);
  if (loaded.kind !== 'ok') {
    return loaded;
  }
  const { stripe, subscription, item, planId } = loaded;
  if (!VALID_PAID_PLAN_IDS.some(valid => valid === planId)) {
    return { kind: 'invalid', reason: 'unknown_plan' };
  }
  if (
    subscription.status !== 'active' ||
    subscription.cancel_at_period_end ||
    subscription.cancel_at != null ||
    subscription.pending_update != null
  ) {
    return { kind: 'not_renewing', reason: 'subscription_not_renewing' };
  }
  if (subscription.collection_method === 'send_invoice') {
    return { kind: 'not_renewing', reason: 'manual_collection' };
  }
  if (subscription.collection_method !== 'charge_automatically') {
    return { kind: 'unavailable', reason: 'invalid_collection_method' };
  }
  const invoice = subscription.latest_invoice;
  if (typeof invoice === 'string') {
    return { kind: 'unavailable', reason: 'invoice_not_expanded' };
  }
  if (
    invoice?.status === 'open' &&
    (!Number.isSafeInteger(invoice.amount_remaining) ||
      invoice.amount_remaining < 0)
  ) {
    return { kind: 'unavailable', reason: 'invalid_pending_invoice' };
  }
  if (
    invoice != null &&
    typeof invoice !== 'string' &&
    invoice.status === 'open' &&
    invoice.amount_remaining > 0
  ) {
    return { kind: 'not_renewing', reason: 'payment_pending' };
  }
  const timestamp = item.current_period_end * 1000;
  const start = window.start.getTime();
  const end = window.end.getTime();
  if (
    !Number.isSafeInteger(item.current_period_end) ||
    item.current_period_end <= 0 ||
    !Number.isFinite(timestamp) ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start > end
  ) {
    return { kind: 'unavailable', reason: 'invalid_renewal_date' };
  }
  if (timestamp < start || timestamp > end) {
    return { kind: 'not_renewing', reason: 'outside_reminder_window' };
  }
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) {
    return { kind: 'unavailable', reason: 'invalid_renewal_date' };
  }
  const pause = subscription.pause_collection;
  if (pause != null) {
    if (pause.resumes_at === null) {
      return { kind: 'not_renewing', reason: 'collection_paused' };
    }
    if (
      typeof pause.resumes_at !== 'number' ||
      !Number.isSafeInteger(pause.resumes_at) ||
      pause.resumes_at <= 0 ||
      !Number.isFinite(new Date(pause.resumes_at * 1000).getTime())
    ) {
      return { kind: 'unavailable', reason: 'invalid_collection_resume_date' };
    }
    if (pause.resumes_at >= item.current_period_end) {
      return { kind: 'not_renewing', reason: 'collection_paused' };
    }
  }
  try {
    const preview = await loadInvoicePreview(stripe, subscriptionId);
    if (
      !Number.isSafeInteger(preview.amount_due) ||
      preview.amount_due < 0 ||
      !/^[a-z]{3}$/i.test(preview.currency) ||
      !Intl.supportedValuesOf('currency').includes(
        preview.currency.toUpperCase()
      ) ||
      preview.currency.toLowerCase() !== item.price.currency.toLowerCase()
    ) {
      return { kind: 'unavailable', reason: 'invalid_invoice_preview' };
    }
    return {
      kind: 'available',
      amountMinor: preview.amount_due,
      currency: preview.currency,
      nextChargeAt: date.toISOString(),
      planId,
    };
  } catch {
    return { kind: 'unavailable', reason: 'invoice_preview_failed' };
  }
}

const billingCache = createCache<{
  summary: SubscriptionBillingSummary | null;
}>(SUBSCRIPTION_BILLING_CACHE_TTL_MS);
const pendingReads = new Map<
  string,
  Promise<SubscriptionBillingSummary | null>
>();

/** Read-only Stripe preview outside transactions. A failed read never invents a charge. */
export async function readSubscriptionBilling_IO(
  subscriptionId: string | null,
  accountId: string
): Promise<SubscriptionBillingSummary | null> {
  if (subscriptionId == null) {
    return null;
  }
  const cacheKey = `${accountId}:${subscriptionId}`;
  const cached = billingCache.get(cacheKey);
  if (cached != null) {
    return cached.summary;
  }
  const pending = pendingReads.get(cacheKey);
  if (pending != null) {
    return pending;
  }
  const request = loadSubscriptionBilling_IO(subscriptionId, accountId)
    .then(summary => {
      billingCache.set(cacheKey, { summary });
      return summary;
    })
    .finally(() => pendingReads.delete(cacheKey));
  pendingReads.set(cacheKey, request);
  return request;
}

async function loadSubscriptionBilling_IO(
  subscriptionId: string,
  accountId: string
): Promise<SubscriptionBillingSummary | null> {
  try {
    const loaded = await loadScopedSubscription(
      subscriptionId,
      accountId,
      true
    );
    if (loaded.kind !== 'ok') {
      return null;
    }
    const { stripe, subscription, item } = loaded;
    const product = item.price.product;
    if (typeof product === 'string' || product.deleted) {
      return null;
    }
    const discounts = subscriptionDiscounts(
      subscription.discounts ?? [],
      Date.now(),
      product.id,
      item.price.currency
    );
    const discountFields = discounts.length > 0 ? { discounts } : {};
    const pendingPayment = pendingSubscriptionPayment(subscription);
    const interval = item.price.recurring?.interval;
    const billingPeriod =
      interval === 'year' ? 'yearly' : interval === 'month' ? 'monthly' : null;
    if (pendingPayment !== null) {
      return {
        nextChargeAmount: null,
        nextChargeAt: null,
        currency: item.price.currency,
        billingPeriod,
        pendingPayment,
        ...discountFields,
      };
    }
    if (
      subscription.cancel_at_period_end ||
      subscription.cancel_at != null ||
      !['active', 'trialing'].includes(subscription.status)
    ) {
      return {
        ...discountFields,
        nextChargeAmount: null,
        nextChargeAt: null,
        currency: item.price.currency,
        billingPeriod,
      };
    }
    const invoice = await loadInvoicePreview(stripe, subscriptionId);
    const nextAt =
      subscription.status === 'trialing'
        ? subscription.trial_end
        : item.current_period_end;
    const summary: SubscriptionBillingSummary = {
      ...discountFields,
      nextChargeAmount: invoice.amount_due,
      currency: invoice.currency,
      nextChargeAt:
        nextAt == null ? null : new Date(nextAt * 1000).toISOString(),
      billingPeriod,
    };
    return summary;
  } catch {
    return null;
  }
}
