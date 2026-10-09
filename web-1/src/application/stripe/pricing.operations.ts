import type Stripe from 'stripe';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import type {
  PricingPlanPrice,
  PricingPlansResponse,
} from '@kernel/models/pricing/pricing.dto';
import { CACHE_TTL } from '@kernel/domain/admin/admin.config';
import { createCache } from '@app/cache/cache.utils';
import { getStripe } from './adapters/stripe.adapter';
import {
  getPricingPlanValueFromPlanId,
  isScopedToNailfolio,
} from './stripe.config';
import { reportIssueBackend } from '@app/debugger/error-handler';

const pricingCache = createCache<PricingPlansResponse>(CACHE_TTL.PRICING_PLANS);

const CACHE_KEY = 'pricing-plans';

const buildFallbackResponse = (): PricingPlansResponse => ({
  plans: [
    {
      plan_id: PricingPlanValue.FREE,
      monthly_price: 0,
      yearly_monthly_price: 0,
    },
    {
      plan_id: PricingPlanValue.PRO,
      monthly_price: null,
      yearly_monthly_price: null,
    },
    {
      plan_id: PricingPlanValue.PRO_PLUS,
      monthly_price: null,
      yearly_monthly_price: null,
    },
    {
      plan_id: PricingPlanValue.STUDIO,
      monthly_price: null,
      yearly_monthly_price: null,
    },
    {
      plan_id: PricingPlanValue.SCALE,
      monthly_price: null,
      yearly_monthly_price: null,
    },
  ],
  currency: 'pln',
  is_fallback: true,
  fetched_at: new Date().toISOString(),
});

export const fetchPricingPlans = async (): Promise<PricingPlansResponse> => {
  const cached = pricingCache.get(CACHE_KEY);
  if (cached) {
    return cached;
  }

  try {
    const stripe = getStripe();
    const prices = await stripe.prices.list({
      active: true,
      type: 'recurring',
      expand: ['data.product'],
      limit: 50,
    });

    const planPrices = new Map<
      string,
      { monthly: number | null; yearly_monthly: number | null }
    >();

    for (const price of prices.data) {
      const product = price.product as Stripe.Product;
      if (
        product == null ||
        typeof product === 'string' ||
        product.metadata?.planId == null ||
        // Scope guard: objects on the Stripe account are not assumed to be ours.
        // Without this filter an out-of-scope recurring price would leak into the
        // Nailfolio pricing table.
        !isScopedToNailfolio(product.metadata.planId)
      ) {
        continue;
      }

      const planId = product.metadata.planId;
      const planValue = getPricingPlanValueFromPlanId(planId);
      if (planValue === PricingPlanValue.FREE) {
        continue;
      }

      const existing = planPrices.get(planValue) ?? {
        monthly: null,
        yearly_monthly: null,
      };

      if (price.recurring?.interval === 'month') {
        existing.monthly = price.unit_amount;
      } else if (price.recurring?.interval === 'year' && price.unit_amount) {
        existing.yearly_monthly = Math.round(price.unit_amount / 12);
      }

      planPrices.set(planValue, existing);
    }

    const plans: PricingPlanPrice[] = [
      {
        plan_id: PricingPlanValue.FREE,
        monthly_price: 0,
        yearly_monthly_price: 0,
      },
      {
        plan_id: PricingPlanValue.PRO,
        monthly_price: planPrices.get(PricingPlanValue.PRO)?.monthly ?? null,
        yearly_monthly_price:
          planPrices.get(PricingPlanValue.PRO)?.yearly_monthly ?? null,
      },
      {
        plan_id: PricingPlanValue.PRO_PLUS,
        monthly_price:
          planPrices.get(PricingPlanValue.PRO_PLUS)?.monthly ?? null,
        yearly_monthly_price:
          planPrices.get(PricingPlanValue.PRO_PLUS)?.yearly_monthly ?? null,
      },
      {
        plan_id: PricingPlanValue.STUDIO,
        monthly_price: planPrices.get(PricingPlanValue.STUDIO)?.monthly ?? null,
        yearly_monthly_price:
          planPrices.get(PricingPlanValue.STUDIO)?.yearly_monthly ?? null,
      },
      {
        plan_id: PricingPlanValue.SCALE,
        monthly_price: null,
        yearly_monthly_price: null,
      },
    ];

    const response: PricingPlansResponse = {
      plans,
      currency: 'pln',
      is_fallback: false,
      fetched_at: new Date().toISOString(),
    };

    pricingCache.set(CACHE_KEY, response);
    return response;
  } catch (error) {
    reportIssueBackend({
      namespace: 'PRICING_FETCH',
      message: 'Stripe Prices API failed, using fallback',
      payload: { error: error instanceof Error ? error.message : 'unknown' },
      mode: 'error',
    });

    const fallback = buildFallbackResponse();
    // Fallback z krótkim TTL (60s): pełne 60 min blokowało odzysk — gdy
    // Stripe wracał, backend serwował zatruty fallback do godziny, a
    // frontendowa dociążka (refetch 30s na is_fallback) odbijała się od cache.
    pricingCache.set(CACHE_KEY, fallback, 60 * 1000);
    return fallback;
  }
};

export const clearPricingCache = (): void => {
  pricingCache.clear();
};
