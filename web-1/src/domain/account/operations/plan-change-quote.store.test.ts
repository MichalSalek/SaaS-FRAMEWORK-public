import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import {
  clearPlanChangeQuoteStore,
  PLAN_CHANGE_QUOTE_LIMIT,
  PLAN_CHANGE_QUOTE_TTL_MS,
  readPlanChangeQuote,
  savePlanChangeQuote,
  type NewPlanChangeQuote,
} from './plan-change-quote.store';

const quoteInput = (accountId: string): NewPlanChangeQuote => ({
  accountId,
  subscriptionId: 'sub_store',
  targetPlanId: PricingPlanValue.PRO_PLUS,
  targetPriceId: 'price_store',
  billingPeriod: 'month',
  fingerprint: `fp-${accountId}`,
  prorationDate: 1_700_000_000,
  amountDue: 0,
  total: -20,
  taxAmount: null,
  currency: 'pln',
});

describe('plan-change quote store', () => {
  beforeEach(() => {
    clearPlanChangeQuoteStore();
  });

  it('keeps a zero amount and drops the oldest past the cap', () => {
    const first = savePlanChangeQuote(quoteInput('acc-0'), 1_000);
    expect(readPlanChangeQuote(first.quoteId)?.amountDue).toBe(0);
    expect(readPlanChangeQuote(first.quoteId)?.total).toBe(-20);
    for (let index = 1; index < PLAN_CHANGE_QUOTE_LIMIT; index += 1) {
      savePlanChangeQuote(quoteInput(`acc-${index}`), 1_000);
    }
    expect(readPlanChangeQuote(first.quoteId)).not.toBeNull();
    savePlanChangeQuote(quoteInput('acc-overflow'), 1_000);
    expect(readPlanChangeQuote(first.quoteId)).toBeNull();
    expect(readPlanChangeQuote(first.quoteId)?.subscriptionId).toBeUndefined();
  });

  it('still returns an expired record so the caller can name the reason', () => {
    const saved = savePlanChangeQuote(quoteInput('acc'), 5_000);
    expect(saved.expiresAt).toBe(5_000 + PLAN_CHANGE_QUOTE_TTL_MS);
    expect(readPlanChangeQuote(saved.quoteId)?.expiresAt).toBe(saved.expiresAt);
  });

  it('shares one map across separately evaluated module copies', async () => {
    clearPlanChangeQuoteStore();
    vi.resetModules();
    const first = await import('./plan-change-quote.store');
    const saved = first.savePlanChangeQuote(quoteInput('acc-shared'), 5_000);
    vi.resetModules();
    const second = await import('./plan-change-quote.store');
    expect(second).not.toBe(first);
    expect(second.readPlanChangeQuote(saved.quoteId)?.accountId).toBe(
      'acc-shared'
    );
    expect(second.readPlanChangeQuote(saved.quoteId)?.subscriptionId).toBe(
      'sub_store'
    );
  });
});
