/**
 * SPE price-resolver unit tests — resolveCheckoutPrice_IO.
 *
 * Calls the operation DIRECTLY with a mocked Stripe adapter (getStripe().prices.list).
 * No network, no DB. The Stripe account is exercised via fixture price/product
 * lists so the Nailfolio scope-guard (`isScopedToNailfolio`) can be asserted against an
 * out-of-scope product.
 *
 * Cache note: the resolver keeps a module-level priceCache keyed on (planId, period).
 * Each test below uses a DISTINCT plan/period (or a guaranteed-failure branch that
 * never caches), so no cross-test cache bleed occurs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';

// ── Mock the Stripe adapter: getStripe().prices.list is the only call site. ──────
const pricesList = vi.fn();
vi.mock('@app/stripe/adapters/stripe.adapter', () => ({
  getStripe: () => ({ prices: { list: pricesList } }),
}));

// reportIssueBackend is fire-and-forget logging; stub it so the failure branches
// don't reach into the real error-handler chain.
vi.mock('@app/debugger/error-handler', () => ({
  reportIssueBackend: vi.fn(),
}));

import { resolveCheckoutPrice_IO } from './price-resolver.operations';

/** Build a Stripe-shaped price with an expanded product carrying `metadata.planId`. */
const makePrice = ({
  id,
  productPlanId,
  interval,
}: {
  id: string;
  productPlanId: string;
  interval: 'month' | 'year';
}): unknown => ({
  id,
  recurring: { interval },
  product: {
    object: 'product',
    metadata: { planId: productPlanId },
  },
});

const apiList = (data: unknown[]): unknown => ({ object: 'list', data });

describe('resolveCheckoutPrice_IO — SPE checkout price resolution', () => {
  beforeEach(() => {
    pricesList.mockReset();
  });

  it('FREE → CHECKOUT_PLAN_NOT_FOUND (no Stripe product, never lists prices)', async () => {
    const result = await resolveCheckoutPrice_IO({
      planId: PricingPlanValue.FREE,
      billingPeriod: 'month',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('CHECKOUT_PLAN_NOT_FOUND');
    }
    // Short-circuits before any Stripe call.
    expect(pricesList).not.toHaveBeenCalled();
  });

  it('SCALE → CHECKOUT_PLAN_NOT_FOUND (custom/contact, no self-serve checkout)', async () => {
    const result = await resolveCheckoutPrice_IO({
      planId: PricingPlanValue.SCALE,
      billingPeriod: 'year',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('CHECKOUT_PLAN_NOT_FOUND');
    }
    expect(pricesList).not.toHaveBeenCalled();
  });

  it('PRO/month → success { priceId } when scoped product + matching interval exist', async () => {
    pricesList.mockResolvedValue(
      apiList([
        // out-of-scope product — must be ignored.
        makePrice({
          id: 'price_out_of_scope',
          productPlanId: 'other-plan',
          interval: 'month',
        }),
        // PRO product (app-price-1), month interval — the target.
        makePrice({
          id: 'price_pro_month',
          productPlanId: 'app-price-1',
          interval: 'month',
        }),
      ])
    );

    const result = await resolveCheckoutPrice_IO({
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priceId).toBe('price_pro_month');
    }
    expect(pricesList).toHaveBeenCalledTimes(1);
  });

  it('PRO_PLUS/year → CHECKOUT_PRICE_RESOLVE_FAILED when product exists but no price for the interval', async () => {
    // app-price-2 product exists but ONLY with a month price (no year) → resolve fail.
    pricesList.mockResolvedValue(
      apiList([
        makePrice({
          id: 'price_proplus_month',
          productPlanId: 'app-price-2',
          interval: 'month',
        }),
      ])
    );

    const result = await resolveCheckoutPrice_IO({
      planId: PricingPlanValue.PRO_PLUS,
      billingPeriod: 'year',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('CHECKOUT_PRICE_RESOLVE_FAILED');
    }
  });

  it('out-of-scope product is NOT matched (scope guard) → STUDIO not found', async () => {
    // The ONLY recurring price on the account is out of scope (product metadata
    // is not app-price-*). Scope guard skips it → not found.
    pricesList.mockResolvedValue(
      apiList([
        makePrice({
          id: 'price_out_of_scope',
          productPlanId: 'other-plan',
          interval: 'month',
        }),
      ])
    );

    const result = await resolveCheckoutPrice_IO({
      planId: PricingPlanValue.STUDIO,
      billingPeriod: 'month',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('CHECKOUT_PLAN_NOT_FOUND');
    }
  });

  it('Stripe prices.list throws → CHECKOUT_PRICE_RESOLVE_FAILED', async () => {
    pricesList.mockRejectedValue(new Error('stripe down'));

    const result = await resolveCheckoutPrice_IO({
      planId: PricingPlanValue.STUDIO,
      billingPeriod: 'year',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('CHECKOUT_PRICE_RESOLVE_FAILED');
    }
  });
});
