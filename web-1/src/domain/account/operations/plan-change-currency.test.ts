import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { mockDb } from '../../../test-utils/mockApiHandler';
import {
  figures,
  itemOf,
  owned,
  SUB_ID,
} from './account-plan-change.quote.fixtures';
const { retrieve, update, createPreview, resolvePrice, priceRetrieve } =
  vi.hoisted(() => ({
    retrieve: vi.fn(),
    priceRetrieve: vi.fn(),
    update: vi.fn(),
    createPreview: vi.fn(),
    resolvePrice: vi.fn(),
  }));
vi.mock('@app/stripe/adapters/stripe.adapter', () => ({
  getStripe: () => ({
    subscriptions: { retrieve, update },
    prices: { retrieve: priceRetrieve },
    invoices: { createPreview },
  }),
}));
vi.mock('@app/stripe/price-resolver.operations', () => ({
  resolveCheckoutPrice_IO: resolvePrice,
}));
import { previewPaidPlanChange_IO } from './plan-change-quote.operations';
import { changePaidPlan_IO } from './account-plan-change.operations';
describe('subscription currency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb({
      user: {
        findUnique: async () => ({
          stylist_account: {
            account_id: 'acc_test_0000000000000001',
            subscription_id: SUB_ID,
          },
        }),
      },
    });
    const current = owned();
    const item = itemOf(current);
    item.price = { ...(item.price as object), currency: 'usd' };
    retrieve.mockResolvedValue(current);
    createPreview.mockResolvedValue(figures({ currency: 'usd' }));
    update.mockResolvedValue({
      latest_invoice: {
        ...figures({ currency: 'usd' }),
        id: 'in_1',
        status: 'paid',
        amount_remaining: 0,
      },
    });
    priceRetrieve.mockResolvedValue({
      id: 'price_usd_target',
      currency: 'usd',
      billing_scheme: 'per_unit',
      tax_behavior: 'inclusive',
      unit_amount: 4900,
    });
    resolvePrice.mockReset();
    resolvePrice.mockResolvedValue({
      success: true,
      data: { priceId: 'price_usd_target' },
    });
  });
  it('omits historical trial and returns gross target amount and provider boundary', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_100_000);
    const current = owned({ trial_end: 1_700_000_000 });
    const item = itemOf(current);
    item.quantity = 2;
    item.price = { ...(item.price as object), currency: 'usd' };
    retrieve.mockResolvedValue(current);
    createPreview.mockResolvedValue(
      figures({
        currency: 'usd',
        lines: {
          data: [
            {
              pricing: { price_details: { price: 'price_usd_target' } },
              period: { end: 1_702_592_000 },
            },
          ],
        },
      })
    );
    try {
      const quote = await previewPaidPlanChange_IO({
        userId: 'user',
        targetPlanId: PricingPlanValue.PRO_PLUS,
        billingPeriod: 'month',
      });
      expect(quote).toMatchObject({
        success: true,
        data: {
          trialEndsAt: null,
          regularAmount: 9800,
          nextBillingAt: new Date(1_702_592_000 * 1000).toISOString(),
          amountDue: 1290,
          total: 1290,
        },
      });
      expect(priceRetrieve).toHaveBeenCalledWith('price_usd_target');
      expect(update).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
  });
  it('rejects unreadable or unsupported target catalog prices', async () => {
    const preview = () =>
      previewPaidPlanChange_IO({
        userId: 'user',
        targetPlanId: PricingPlanValue.PRO_PLUS,
        billingPeriod: 'month',
      });
    priceRetrieve.mockRejectedValueOnce(new Error('unavailable'));
    expect(await preview()).toMatchObject({
      success: false,
      error: { operation: 'previewPaidPlanChange:targetPrice' },
    });
    priceRetrieve.mockResolvedValueOnce({
      id: 'price_usd_target',
      currency: 'pln',
      billing_scheme: 'per_unit',
      tax_behavior: 'inclusive',
      unit_amount: 4900,
    });
    expect(await preview()).toMatchObject({
      success: false,
      error: { operation: 'previewPaidPlanChange:targetPrice' },
    });
    expect(update).not.toHaveBeenCalled();
  });
  it('quotes and confirms using the existing USD subscription, not visitor market', async () => {
    const quote = await previewPaidPlanChange_IO({
      userId: 'user',
      targetPlanId: PricingPlanValue.PRO_PLUS,
      billingPeriod: 'month',
    });
    expect(quote).toMatchObject({ success: true, data: { currency: 'usd' } });
    expect(resolvePrice).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'usd' })
    );
    if (!quote.success) {
      throw new Error('preview failed');
    }
    const result = await changePaidPlan_IO({
      userId: 'user',
      targetPlanId: PricingPlanValue.PRO_PLUS,
      billingPeriod: 'month',
      quoteId: quote.data.quoteId,
    });
    expect(result.success).toBe(true);
    expect(resolvePrice).toHaveBeenLastCalledWith(
      expect.objectContaining({ currency: 'usd' })
    );
  });
  it('invalidates a quote if the subscription changes tax mode', async () => {
    const quote = await previewPaidPlanChange_IO({
      userId: 'user',
      targetPlanId: PricingPlanValue.PRO_PLUS,
      billingPeriod: 'month',
    });
    if (!quote.success) {
      throw new Error('preview failed');
    }
    const changed = owned({ automatic_tax: { enabled: true } });
    const item = itemOf(changed);
    item.price = { ...(item.price as object), currency: 'usd' };
    retrieve.mockResolvedValue(changed);
    const result = await changePaidPlan_IO({
      userId: 'user',
      targetPlanId: PricingPlanValue.PRO_PLUS,
      billingPeriod: 'month',
      quoteId: quote.data.quoteId,
    });
    expect(result).toMatchObject({
      success: false,
      error: { type: 'PLAN_CHANGE_QUOTE_STALE', reason: 'changed' },
    });
  });
});

vi.mock('./plan-change-lease', async () => import('./plan-change-lease.mock'));
