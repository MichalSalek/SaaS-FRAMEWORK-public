import { describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import { readPlanChangeTerms } from './plan-change-terms';

const NOW = 1_700_000_000;
const MONTH_END = NOW + 2_592_000;
const YEAR_END = NOW + 31_536_000;
const price = {
  id: 'price_target',
  currency: 'pln',
  billing_scheme: 'per_unit',
  tax_behavior: 'inclusive',
  unit_amount: 4900,
} as Stripe.Price;
const line = (id: string, end: number) => ({
  pricing: { price_details: { price: id } },
  period: { end },
});
const input = (patch: Record<string, unknown> = {}) => ({
  targetPrice: price,
  targetPriceId: 'price_target',
  currency: 'pln',
  quantity: 2,
  status: 'active',
  trialEnd: NOW - 1,
  currentPeriodEnd: MONTH_END,
  currentInterval: 'month',
  billingPeriod: 'month' as const,
  invoice: {
    lines: { data: [line('price_target', MONTH_END)] },
  } as Stripe.Invoice,
  cancelAt: null,
  now: NOW,
  ...patch,
});

describe('plan change informative terms', () => {
  it('suppresses historical trials while showing the target gross amount and period', () => {
    expect(readPlanChangeTerms(input())).toEqual({
      regularAmount: 9800,
      trialEndsAt: null,
      nextBillingAt: new Date(MONTH_END * 1000).toISOString(),
    });
  });
  it('uses only a valid future trial for trialing subscriptions', () => {
    const expected = new Date(MONTH_END * 1000).toISOString();
    expect(
      readPlanChangeTerms(
        input({
          status: 'trialing',
          trialEnd: MONTH_END,
          billingPeriod: 'year',
        })
      )
    ).toMatchObject({ trialEndsAt: expected, nextBillingAt: expected });
    expect(
      readPlanChangeTerms(
        input({
          status: 'trialing',
          trialEnd: NOW - 1,
          invoice: { lines: { data: [] } },
          billingPeriod: 'year',
        })
      )
    ).toMatchObject({ trialEndsAt: null, nextBillingAt: null });
  });
  it('uses the matching target line, never the old monthly end for an annual switch', () => {
    const invoice = {
      lines: {
        data: [line('price_old', MONTH_END), line('price_target', YEAR_END)],
      },
    };
    expect(
      readPlanChangeTerms(input({ invoice, billingPeriod: 'year' }))
        ?.nextBillingAt
    ).toBe(new Date(YEAR_END * 1000).toISOString());
    expect(
      readPlanChangeTerms(
        input({ invoice: { lines: { data: [] } }, billingPeriod: 'year' })
      )?.nextBillingAt
    ).toBeNull();
    expect(
      readPlanChangeTerms(input({ invoice: { lines: { data: [] } } }))
        ?.nextBillingAt
    ).toBe(new Date(MONTH_END * 1000).toISOString());
  });
  it('suppresses a billing boundary at or after the scheduled cancellation', () => {
    expect(
      readPlanChangeTerms(
        input({ cancelAt: new Date(MONTH_END * 1000).toISOString() })
      )?.nextBillingAt
    ).toBeNull();
    expect(
      readPlanChangeTerms(
        input({ cancelAt: new Date((MONTH_END - 1) * 1000).toISOString() })
      )?.nextBillingAt
    ).toBeNull();
  });
  it('rejects unsupported or unsafe catalog prices and quantities', () => {
    for (const targetPrice of [
      { ...price, currency: 'usd' },
      { ...price, id: 'other' },
      { ...price, unit_amount: null },
      { ...price, tax_behavior: 'exclusive' },
      { ...price, billing_scheme: 'tiered' },
      { ...price, unit_amount: Number.MAX_SAFE_INTEGER },
    ]) {
      expect(readPlanChangeTerms(input({ targetPrice }))).toBeNull();
    }
    for (const quantity of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(readPlanChangeTerms(input({ quantity }))).toBeNull();
    }
  });
});
