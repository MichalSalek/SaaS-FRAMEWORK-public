import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const list = vi.fn();
vi.mock('@app/stripe/adapters/stripe.adapter', () => ({
  getStripe: () => ({ prices: { list } }),
}));
vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));
import { clearPricingCache, fetchPricingPlans } from './pricing.operations';

const catalog = () =>
  ['app-price-1', 'app-price-2', 'app-price-3'].flatMap(planId =>
    ['month', 'year'].map(interval => ({
      id: `${planId}-${interval}`,
      currency: 'eur',
      unit_amount: interval === 'month' ? 1900 : 18000,
      billing_scheme: 'per_unit',
      tax_behavior: 'inclusive',
      recurring: { interval, interval_count: 1 },
      product: { metadata: { planId } },
    }))
  );

beforeEach(() => {
  clearPricingCache();
  list.mockReset();
});
afterEach(() => vi.restoreAllMocks());

it('recovers a missing currency within a minute after its prices are published', async () => {
  let now = 1_800_000_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  list.mockResolvedValue({ data: [], has_more: false });
  const missing = await fetchPricingPlans('eur');
  expect(missing).toMatchObject({ currency: 'eur', is_fallback: true });
  expect(
    missing.plans.find(plan => plan.plan_id === 'PRO')?.monthly_price
  ).toBeNull();
  list.mockResolvedValue({ data: catalog(), has_more: false });
  now += 60_001;
  expect(await fetchPricingPlans('eur')).toMatchObject({
    currency: 'eur',
    is_fallback: false,
    plans: expect.arrayContaining([
      expect.objectContaining({ plan_id: 'PRO', monthly_price: 1900 }),
    ]),
  });
  expect(list).toHaveBeenCalledTimes(2);
});

it('degrades an incomplete or exclusive catalog without presenting an invented total', async () => {
  const partial = catalog().map((price, index) =>
    index === 0 ? { ...price, tax_behavior: 'exclusive' } : price
  );
  list.mockResolvedValue({ data: partial, has_more: false });
  const data = await fetchPricingPlans('eur');
  expect(data.is_fallback).toBe(true);
  expect(
    data.plans.find(plan => plan.plan_id === 'PRO')?.monthly_price
  ).toBeNull();
});
