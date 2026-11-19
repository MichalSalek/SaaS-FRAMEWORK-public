import type Stripe from 'stripe';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import type { PricingPlansResponse } from '@kernel/models/pricing/pricing.dto';
import type { BillingCurrency } from '@kernel/domain/localization/country.config';
import { CACHE_TTL } from '@kernel/domain/admin/admin.config';
import { createCache } from '@app/cache/cache.utils';
import {
  getPricingPlanValueFromPlanId,
  isScopedToNailfolio,
} from './stripe.config';
import { listActiveRecurringPrices } from './stripe-price-list';
import { isSupportedGrossPrice } from './stripe-price-policy';
import { reportIssueBackend } from '@app/debugger/error-handler';

const pricingCache = createCache<PricingPlansResponse>(CACHE_TTL.PRICING_PLANS);
const planIds = [
  PricingPlanValue.FREE,
  PricingPlanValue.PRO,
  PricingPlanValue.PRO_PLUS,
  PricingPlanValue.STUDIO,
  PricingPlanValue.SCALE,
] as const;

export const fetchPricingPlans = async (
  currency: BillingCurrency = 'pln'
): Promise<PricingPlansResponse> => {
  const key = `pricing-plans:${currency}`;
  const cached = pricingCache.get(key);
  if (cached) {
    return cached;
  }
  try {
    const prices = await listActiveRecurringPrices();
    const amounts = new Map<string, number | null>();
    for (const price of prices) {
      const product = price.product as Stripe.Product | string | null;
      if (
        product === null ||
        typeof product === 'string' ||
        !product.metadata?.planId ||
        !isScopedToNailfolio(product.metadata.planId) ||
        !isSupportedGrossPrice(price) ||
        price.currency !== currency ||
        price.recurring?.interval_count !== 1 ||
        (price.recurring.interval !== 'month' &&
          price.recurring.interval !== 'year')
      ) {
        continue;
      }
      const plan = getPricingPlanValueFromPlanId(product.metadata.planId);
      if (plan === PricingPlanValue.FREE || plan === PricingPlanValue.SCALE) {
        continue;
      }
      const amountKey = `${plan}:${price.recurring.interval}`;
      if (amounts.has(amountKey)) {
        throw new Error('Ambiguous Nailfolio price');
      }
      amounts.set(amountKey, price.unit_amount);
    }
    const complete = [
      PricingPlanValue.PRO,
      PricingPlanValue.PRO_PLUS,
      PricingPlanValue.STUDIO,
    ].every(
      plan =>
        amounts.get(`${plan}:month`) != null &&
        amounts.get(`${plan}:year`) != null
    );
    const response: PricingPlansResponse = {
      plans: planIds.map(plan_id => {
        const free = plan_id === PricingPlanValue.FREE;
        const yearly = free ? 0 : (amounts.get(`${plan_id}:year`) ?? null);
        return {
          plan_id,
          monthly_price: free ? 0 : (amounts.get(`${plan_id}:month`) ?? null),
          yearly_monthly_price:
            yearly === null ? null : Math.round(yearly / 12),
          yearly_total: yearly,
        };
      }),
      currency,
      is_fallback: !complete,
      fetched_at: new Date().toISOString(),
    };
    pricingCache.set(key, response, complete ? undefined : 60 * 1000);
    return response;
  } catch (error) {
    reportIssueBackend({
      namespace: 'PRICING_FETCH',
      message: 'Stripe Prices API failed, using fallback',
      payload: { error: error instanceof Error ? error.message : 'unknown' },
      mode: 'error',
    });
    const fallback: PricingPlansResponse = {
      plans: planIds.map(plan_id => ({
        plan_id,
        monthly_price: plan_id === PricingPlanValue.FREE ? 0 : null,
        yearly_monthly_price: plan_id === PricingPlanValue.FREE ? 0 : null,
        yearly_total: plan_id === PricingPlanValue.FREE ? 0 : null,
      })),
      currency,
      is_fallback: true,
      fetched_at: new Date().toISOString(),
    };
    pricingCache.set(key, fallback, 60 * 1000);
    return fallback;
  }
};
export const clearPricingCache = (): void => {
  pricingCache.clear();
};
