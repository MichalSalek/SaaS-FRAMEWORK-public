import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
const list = vi.fn();
vi.mock('@app/stripe/adapters/stripe.adapter', () => ({
  getStripe: () => ({ prices: { list } }),
}));
vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));
import { clearPricingCache, fetchPricingPlans } from './pricing.operations';
import {
  clearPriceResolverCache,
  resolveCheckoutPrice_IO,
} from './price-resolver.operations';

const price = (
  id: string,
  currency: string,
  interval: 'month' | 'year',
  amount: number,
  plan = 'app-price-1'
) => ({
  id,
  currency,
  unit_amount: amount,
  billing_scheme: 'per_unit',
  tax_behavior: 'inclusive',
  recurring: { interval, interval_count: 1 },
  product: { metadata: { planId: plan } },
});

describe('regional Stripe catalog', () => {
  beforeEach(() => {
    list.mockReset();
    clearPricingCache();
    clearPriceResolverCache();
  });
  it('reads all pages, scopes the product and partitions caches by currency', async () => {
    list.mockImplementation(
      async ({ starting_after }: { starting_after?: string }) =>
        starting_after
          ? {
              data: [
                price('usd', 'usd', 'month', 1900),
                price('annual', 'usd', 'year', 21001),
              ],
              has_more: false,
            }
          : {
              data: [
                price('foreign', 'usd', 'month', 1, 'piekno'),
                price('pl', 'pln', 'month', 7900),
              ],
              has_more: true,
            }
    );
    const usd = await fetchPricingPlans('usd');
    const pln = await fetchPricingPlans();
    expect(usd.currency).toBe('usd');
    expect(
      usd.plans.find(p => p.plan_id === PricingPlanValue.PRO)
    ).toMatchObject({
      monthly_price: 1900,
      yearly_total: 21001,
      yearly_monthly_price: 1750,
    });
    expect(
      pln.plans.find(p => p.plan_id === PricingPlanValue.PRO)?.monthly_price
    ).toBe(7900);
    const resolved = await resolveCheckoutPrice_IO({
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
      currency: 'usd',
    });
    expect(resolved).toMatchObject({ success: true, data: { priceId: 'usd' } });
  });
  it('fails closed for duplicated matching prices and keeps requested fallback currency', async () => {
    list.mockResolvedValue({
      data: [
        price('a', 'eur', 'month', 1900),
        price('b', 'eur', 'month', 2000),
      ],
      has_more: false,
    });
    expect(
      await resolveCheckoutPrice_IO({
        planId: PricingPlanValue.PRO,
        billingPeriod: 'month',
        currency: 'eur',
      })
    ).toMatchObject({
      success: false,
      error: { type: 'CHECKOUT_PRICE_RESOLVE_FAILED' },
    });
    expect(await fetchPricingPlans('eur')).toMatchObject({
      currency: 'eur',
      is_fallback: true,
      plans: expect.arrayContaining([
        expect.objectContaining({
          plan_id: PricingPlanValue.PRO,
          monthly_price: null,
        }),
      ]),
    });
  });
  it('degrades on Stripe errors without inventing prices', async () => {
    list.mockRejectedValue(new Error('unavailable'));
    expect(await fetchPricingPlans('usd')).toMatchObject({
      currency: 'usd',
      is_fallback: true,
      plans: expect.arrayContaining([
        expect.objectContaining({
          plan_id: PricingPlanValue.PRO,
          monthly_price: null,
        }),
      ]),
    });
  });
});
