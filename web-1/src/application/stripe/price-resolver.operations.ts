import type Stripe from 'stripe';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  CheckoutPlanNotFoundError,
  CheckoutPriceResolveError,
} from '@kernel/domain/user-and-account/account-errors.types';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import { CACHE_TTL } from '@kernel/domain/admin/admin.config';
import { createCache } from '@app/cache/cache.utils';
import { listActiveRecurringPrices } from './stripe-price-list';
import { isSupportedGrossPrice } from './stripe-price-policy';
import type { BillingCurrency } from '@kernel/domain/localization/country.config';
import {
  getPlanIdFromPricingPlanValue,
  isScopedToNailfolio,
} from './stripe.config';
import { reportIssueBackend } from '@app/debugger/error-handler';

// DECISION: the resolver is separate from fetchPricingPlans (pricing.operations.ts): that one
// builds DISPLAY data (monthly/yearly_monthly in minor units for the LP), this one returns the
// raw Stripe priceId for checkout. Different shape, cache key and TTL, deliberately not shared so
// a display-format change cannot break the payment resolver.
type ResolvedPrice = { priceId: string };

const priceCache = createCache<ResolvedPrice>(CACHE_TTL.PRICING_PLANS);

const cacheKey = (
  planId: PricingPlan,
  billingPeriod: BillingPeriod,
  currency: BillingCurrency
): string => `checkout-price:${planId}:${billingPeriod}:${currency}`;

export const resolveCheckoutPrice_IO = async ({
  planId,
  billingPeriod,
  currency = 'pln',
}: {
  planId: PricingPlan;
  billingPeriod: BillingPeriod;
  currency?: BillingCurrency;
}): Promise<
  OperationResult<
    ResolvedPrice,
    CheckoutPlanNotFoundError | CheckoutPriceResolveError
  >
> => {
  // FREE / SCALE have no self-serve Stripe price for checkout.
  if (planId === PricingPlanValue.FREE || planId === PricingPlanValue.SCALE) {
    return failure({ type: 'CHECKOUT_PLAN_NOT_FOUND', planId });
  }

  const stripeProductPlanId = getPlanIdFromPricingPlanValue(planId);

  // Defense-in-depth: the kernel map is exhaustive, but explicitly reject anything outside the
  // Nailfolio scope (e.g. if the kernel ever mapped to a foreign planId).
  if (!isScopedToNailfolio(stripeProductPlanId)) {
    return failure({ type: 'CHECKOUT_PLAN_NOT_FOUND', planId });
  }

  const cached = priceCache.get(cacheKey(planId, billingPeriod, currency));
  if (cached) {
    return success(cached);
  }

  const targetInterval: Stripe.Price.Recurring.Interval =
    billingPeriod === 'month' ? 'month' : 'year';

  let prices: Stripe.Price[];
  try {
    prices = await listActiveRecurringPrices();
  } catch (error) {
    reportIssueBackend({
      namespace: 'CHECKOUT_PRICE_RESOLVE',
      message: 'Stripe prices.list failed during checkout price resolve',
      payload: {
        planId,
        billingPeriod,
        error: error instanceof Error ? error.message : 'unknown',
      },
      mode: 'error',
    });
    return failure({
      type: 'CHECKOUT_PRICE_RESOLVE_FAILED',
      planId,
      billingPeriod,
    });
  }

  let productFound = false;
  let matchedPriceId: string | null = null;

  for (const price of prices) {
    const product = price.product as Stripe.Product;
    if (
      product == null ||
      typeof product === 'string' ||
      // Scope guard: skip out-of-scope products (not app-price-*).
      !isScopedToNailfolio(product.metadata?.planId)
    ) {
      continue;
    }
    if (product.metadata?.planId !== stripeProductPlanId) {
      continue;
    }
    productFound = true;
    if (
      price.currency === currency &&
      price.recurring?.interval === targetInterval &&
      price.recurring.interval_count === 1
    ) {
      // Checkout prices must represent a fixed gross amount; otherwise Stripe could
      // charge a different amount from the published tax-inclusive catalog.
      if (!isSupportedGrossPrice(price)) {
        reportIssueBackend({
          namespace: 'CHECKOUT_PRICE_RESOLVE',
          message: 'Invalid checkout price configuration',
          payload: { planId, billingPeriod, currency, priceId: price.id },
          mode: 'error',
        });
        return failure({
          type: 'CHECKOUT_PRICE_RESOLVE_FAILED',
          planId,
          billingPeriod,
        });
      }
      if (matchedPriceId !== null) {
        return failure({
          type: 'CHECKOUT_PRICE_RESOLVE_FAILED',
          planId,
          billingPeriod,
        });
      }
      matchedPriceId = price.id;
    }
  }

  if (!productFound) {
    return failure({ type: 'CHECKOUT_PLAN_NOT_FOUND', planId });
  }

  if (matchedPriceId === null) {
    // Product exists but has no active recurring price for this interval.
    reportIssueBackend({
      namespace: 'CHECKOUT_PRICE_RESOLVE',
      message: 'No active recurring price for requested interval',
      payload: { planId, billingPeriod, stripeProductPlanId, targetInterval },
      mode: 'error',
    });
    return failure({
      type: 'CHECKOUT_PRICE_RESOLVE_FAILED',
      planId,
      billingPeriod,
    });
  }

  const resolved: ResolvedPrice = { priceId: matchedPriceId };
  priceCache.set(cacheKey(planId, billingPeriod, currency), resolved);
  return success(resolved);
};

export const clearPriceResolverCache = (): void => {
  priceCache.clear();
};
