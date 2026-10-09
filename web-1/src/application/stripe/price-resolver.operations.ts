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
import { getStripe } from './adapters/stripe.adapter';
import {
  getPlanIdFromPricingPlanValue,
  isScopedToNailfolio,
} from './stripe.config';
import { reportIssueBackend } from '@app/debugger/error-handler';

// DECISION (nie usuwaj tego komentarza):
// Resolver oddzielny od fetchPricingPlans (pricing.operations.ts): tamten buduje
// DISPLAY (monthly/yearly_monthly w groszach dla pricingu LP), ten zwraca surowe
// Stripe priceId do checkoutu. Inny kształt, inny cache key, inny TTL — celowo
// nie współdzielą, by zmiana formatu wyświetlania nie tłukła resolvera płatności.
type ResolvedPrice = { priceId: string };

const priceCache = createCache<ResolvedPrice>(CACHE_TTL.PRICING_PLANS);

const cacheKey = (planId: PricingPlan, billingPeriod: BillingPeriod): string =>
  `checkout-price:${planId}:${billingPeriod}`;

/**
 * SPE — rozwiąż Stripe `priceId` dla (planId, billingPeriod) do checkoutu.
 *
 * Maps PricingPlan -> Stripe Product metadata.planId (np. 'app-price-1'), pobiera
 * aktywne recurring ceny scope'owane do Nailfolio (filtr `isScopedToNailfolio`)
 * i wybiera cenę o interwale zgodnym z billingPeriod.
 *
 * FREE i SCALE ('app-price-4') -> CheckoutPlanNotFoundError: FREE nie ma Stripe
 * Product (default po anulowaniu), SCALE = custom/contact (brak self-serve checkout).
 */
export const resolveCheckoutPrice_IO = async ({
  planId,
  billingPeriod,
}: {
  planId: PricingPlan;
  billingPeriod: BillingPeriod;
}): Promise<
  OperationResult<
    ResolvedPrice,
    CheckoutPlanNotFoundError | CheckoutPriceResolveError
  >
> => {
  // FREE / SCALE nie mają self-serve Stripe price do checkoutu.
  if (planId === PricingPlanValue.FREE || planId === PricingPlanValue.SCALE) {
    return failure({ type: 'CHECKOUT_PLAN_NOT_FOUND', planId });
  }

  const stripeProductPlanId = getPlanIdFromPricingPlanValue(planId);

  // Defense-in-depth: kernel map exhaustive, ale jawnie odrzuć cokolwiek poza
  // scope Nailfolio (np. gdyby kernel kiedyś zmapował na planId spoza zakresu).
  if (!isScopedToNailfolio(stripeProductPlanId)) {
    return failure({ type: 'CHECKOUT_PLAN_NOT_FOUND', planId });
  }

  const cached = priceCache.get(cacheKey(planId, billingPeriod));
  if (cached) {
    return success(cached);
  }

  const targetInterval: Stripe.Price.Recurring.Interval =
    billingPeriod === 'month' ? 'month' : 'year';

  let prices: Stripe.ApiList<Stripe.Price>;
  try {
    prices = await getStripe().prices.list({
      active: true,
      type: 'recurring',
      expand: ['data.product'],
      limit: 50,
    });
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

  for (const price of prices.data) {
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
    if (price.recurring?.interval === targetInterval) {
      matchedPriceId = price.id;
      break;
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
  priceCache.set(cacheKey(planId, billingPeriod), resolved);
  return success(resolved);
};

export const clearPriceResolverCache = (): void => {
  priceCache.clear();
};
