import {
  figures,
  grossTargetPrice,
  itemOf,
  owned,
  PERIOD_END,
  SUB_ID,
} from './account-plan-change.quote.fixtures';
import { PLAN_ID_MAP } from '@kernel/domain/stripe/stripe.config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { changePaidPlan_IO } from './account-plan-change.operations';
import { previewPaidPlanChange_IO } from './plan-change-quote.operations';
import {
  clearPlanChangeQuoteStore,
  savePlanChangeQuote,
} from './plan-change-quote.store';

vi.mock('@app/stripe/price-resolver.operations', () => ({
  resolveCheckoutPrice_IO: vi.fn(async () => ({
    success: true,
    data: { priceId: 'price_proplus_month' },
  })),
}));

const subRetrieve = vi.fn();
const subUpdate = vi.fn();
const invoicePreview = vi.fn();
const priceRetrieve = vi.fn(async (id: string) => grossTargetPrice(id));
const invoiceCreate = vi.fn();
const invoiceFinalize = vi.fn();
vi.mock('@app/stripe/adapters/stripe.adapter', () => ({
  getStripe: () => ({
    subscriptions: { retrieve: subRetrieve, update: subUpdate },
    prices: { retrieve: priceRetrieve },
    invoices: {
      createPreview: invoicePreview,
      create: invoiceCreate,
      finalizeInvoice: invoiceFinalize,
    },
  }),
}));

import { resolveCheckoutPrice_IO } from '@app/stripe/price-resolver.operations';

const USER_ID = 'usr_test_0000000000000001';
const ACCOUNT_ID = 'acc_test_0000000000000001';
const TARGET_PRICE = 'price_proplus_month';
const NOW_MS = 1_700_000_100_000;
const PRORATION_DATE = Math.floor(NOW_MS / 1000);

const mockAccount = (): void => {
  mockDb({
    user: {
      findUnique: async () => ({
        stylist_account: {
          account_id: ACCOUNT_ID,
          subscription_id: SUB_ID,
        },
      }),
    },
  });
};

const noMutation = (): void => {
  expect(subUpdate).not.toHaveBeenCalled();
  expect(invoiceCreate).not.toHaveBeenCalled();
  expect(invoiceFinalize).not.toHaveBeenCalled();
};

const preview = () =>
  previewPaidPlanChange_IO({
    userId: USER_ID,
    targetPlanId: PricingPlanValue.PRO_PLUS,
    billingPeriod: 'month',
  });

describe('plan-change preview and quoted confirm', () => {
  beforeEach(() => {
    clearPlanChangeQuoteStore();
    subRetrieve.mockReset();
    subUpdate.mockReset();
    invoicePreview.mockReset();
    invoiceCreate.mockReset();
    invoiceFinalize.mockReset();
    vi.mocked(resolveCheckoutPrice_IO).mockResolvedValue({
      success: true,
      data: { priceId: TARGET_PRICE },
    });
    mockAccount();
  });

  it('previews a zero amount without a Stripe mutation', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(NOW_MS);
    subRetrieve.mockResolvedValue(
      owned({ trial_end: PERIOD_END, cancel_at: PERIOD_END })
    );
    invoicePreview.mockResolvedValue(
      figures({ amount_due: 0, total: -500, total_taxes: null })
    );
    try {
      const result = await preview();
      expect(result.success).toBe(true);
      if (!result.success) {
        return;
      }
      expect(result.data.amountDue).toBe(0);
      expect(result.data.total).toBe(-500);
      expect(result.data.taxAmount).toBeNull();
      expect(result.data.quoteId).toEqual(expect.any(String));
      expect(JSON.stringify(result.data)).not.toContain(SUB_ID);
      const params = invoicePreview.mock.calls[0]?.[0] as {
        subscription_details: {
          proration_date: number;
          proration_behavior: string;
          items: { quantity: number; price: string }[];
        };
      };
      expect(params.subscription_details.proration_date).toBe(PRORATION_DATE);
      expect(params.subscription_details.proration_behavior).toBe(
        'always_invoice'
      );
      expect(params.subscription_details).not.toHaveProperty('trial_end');
      expect(params.subscription_details).not.toHaveProperty('cancel_at');
      expect(params.subscription_details.items[0]?.quantity).toBe(1);
      noMutation();
    } finally {
      now.mockRestore();
    }
  });

  it('does not invent zero when preview fails or the subscription is out of scope', async () => {
    subRetrieve.mockResolvedValue(owned());
    invoicePreview.mockRejectedValue(new Error('no upcoming invoice'));
    const failed = await preview();
    expect(failed.success).toBe(false);
    invoicePreview.mockReset();
    for (const subscription of [
      owned({ metadata: { accountId: 'acc_other' } }),
      owned({ status: 'canceled' }),
    ]) {
      subRetrieve.mockResolvedValue(subscription);
      expect((await preview()).success).toBe(false);
    }
    const foreignProduct = owned();
    itemOf(foreignProduct).price = {
      id: 'price_pro_month',
      recurring: { interval: 'month' },
      product: { metadata: { planId: 'other-product' } }, // planid-literal-allow: foreign product rejection fixture
    };
    subRetrieve.mockResolvedValue(foreignProduct);
    expect((await preview()).success).toBe(false);
    const unexpanded = owned();
    itemOf(unexpanded).price = { id: 'price_pro_month', product: 'prod_x' };
    subRetrieve.mockResolvedValue(unexpanded);
    expect((await preview()).success).toBe(false);
    expect(invoicePreview).not.toHaveBeenCalled();
    noMutation();
  });

  it('invalidates a quote when inherited VAT changes, even with identical zero totals', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(NOW_MS);
    const before = owned({ default_tax_rates: [{ id: 'txr_exclusive' }] });
    itemOf(before).tax_rates = [];
    subRetrieve.mockResolvedValue(before);
    invoicePreview.mockResolvedValue(
      figures({ amount_due: 0, total: 0, total_taxes: [] })
    );
    subUpdate.mockResolvedValue({
      latest_invoice: {
        ...figures({ amount_due: 0, total: 0, total_taxes: [] }),
        id: 'in_zero',
        status: 'paid',
        amount_remaining: 0,
      },
    });
    try {
      const quoted = await preview();
      if (!quoted.success) {
        throw new Error('preview failed');
      }
      const after = owned({ default_tax_rates: [{ id: 'txr_inclusive' }] });
      itemOf(after).tax_rates = [];
      subRetrieve.mockResolvedValue(after);
      const result = await changePaidPlan_IO({
        userId: USER_ID,
        targetPlanId: PricingPlanValue.PRO_PLUS,
        billingPeriod: 'month',
        quoteId: quoted.data.quoteId,
      });
      expect(result).toMatchObject({
        success: false,
        error: { type: 'PLAN_CHANGE_QUOTE_STALE', reason: 'changed' },
      });
      noMutation();
    } finally {
      now.mockRestore();
    }
  });

  it('confirms a year switch with the preview proration date and one quote key', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(NOW_MS);
    vi.mocked(resolveCheckoutPrice_IO).mockResolvedValue({
      success: true,
      data: { priceId: 'price_proplus_year' },
    });
    const current = owned();
    itemOf(current).price = {
      id: 'price_proplus_month',
      currency: 'pln',
      product: { metadata: { planId: PLAN_ID_MAP.PRO_PLUS } },
    };
    subRetrieve.mockResolvedValue(current);
    invoicePreview.mockResolvedValue(figures());
    subUpdate.mockResolvedValue({
      latest_invoice: {
        id: 'in_positive',
        ...figures(),
        status: 'paid',
        amount_remaining: 0,
      },
    });
    try {
      const quoted = await previewPaidPlanChange_IO({
        userId: USER_ID,
        targetPlanId: PricingPlanValue.PRO_PLUS,
        billingPeriod: 'year',
      });
      if (!quoted.success) {
        throw new Error('preview failed');
      }
      const confirm = async () =>
        changePaidPlan_IO({
          userId: USER_ID,
          targetPlanId: PricingPlanValue.PRO_PLUS,
          billingPeriod: 'year',
          quoteId: quoted.data.quoteId,
        });
      expect((await confirm()).success).toBe(true);
      expect((await confirm()).success).toBe(true);
      const keys = subUpdate.mock.calls.map(
        call => (call[2] as { idempotencyKey: string }).idempotencyKey
      );
      expect(keys).toEqual([quoted.data.quoteId, quoted.data.quoteId]);
      const params = subUpdate.mock.calls[0]?.[1] as {
        proration_date: number;
        items: { price: string; quantity: number }[];
      };
      expect(params.proration_date).toBe(PRORATION_DATE);
      expect(params.items[0]).toMatchObject({
        price: 'price_proplus_year',
        quantity: 1,
      });
      const replay = invoicePreview.mock.calls[1]?.[0] as {
        subscription_details: { proration_date: number };
      };
      expect(replay.subscription_details.proration_date).toBe(PRORATION_DATE);
    } finally {
      now.mockRestore();
    }
  });

  it('rejects an expired, foreign, missing, changed, or repriced quote before update', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(NOW_MS);
    subRetrieve.mockResolvedValue(owned());
    invoicePreview.mockResolvedValue(figures());
    try {
      const quoted = await preview();
      if (!quoted.success) {
        throw new Error('preview failed');
      }
      const confirm = (quoteId: string) =>
        changePaidPlan_IO({
          userId: USER_ID,
          targetPlanId: PricingPlanValue.PRO_PLUS,
          billingPeriod: 'month',
          quoteId,
        });
      now.mockReturnValue(NOW_MS + 5 * 60 * 1000);
      const expired = await confirm(quoted.data.quoteId);
      expect(expired.success).toBe(false);
      if (!expired.success) {
        expect(expired.error).toEqual({
          type: 'PLAN_CHANGE_QUOTE_STALE',
          reason: 'expired',
        });
      }
      now.mockReturnValue(NOW_MS);
      const foreign = savePlanChangeQuote(
        {
          accountId: 'acc_other',
          subscriptionId: SUB_ID,
          targetPlanId: PricingPlanValue.PRO_PLUS,
          targetPriceId: TARGET_PRICE,
          billingPeriod: 'month',
          fingerprint: 'unused',
          prorationDate: PRORATION_DATE,
          amountDue: 1290,
          total: 1290,
          taxAmount: 241,
          currency: 'pln',
        },
        NOW_MS
      );
      const foreignResult = await confirm(foreign.quoteId);
      expect(foreignResult.success).toBe(false);
      if (!foreignResult.success) {
        expect(foreignResult.error).toEqual({
          type: 'PLAN_CHANGE_QUOTE_STALE',
          reason: 'invalid',
        });
      }
      const missing = await confirm('11111111-1111-4111-8111-111111111111');
      expect(missing.success).toBe(false);
      if (!missing.success) {
        expect(missing.error).toEqual({
          type: 'PLAN_CHANGE_QUOTE_STALE',
          reason: 'invalid',
        });
      }
      const changedSub = owned();
      itemOf(changedSub).quantity = 2;
      subRetrieve.mockResolvedValueOnce(changedSub);
      const changed = await confirm(quoted.data.quoteId);
      expect(changed.success).toBe(false);
      if (!changed.success) {
        expect(changed.error).toEqual({
          type: 'PLAN_CHANGE_QUOTE_STALE',
          reason: 'changed',
        });
      }
      subRetrieve.mockResolvedValue(owned());
      invoicePreview.mockResolvedValueOnce(
        figures({ currency: 'usd', amount_due: 1400, total: 1400 })
      );
      const mismatch = await confirm(quoted.data.quoteId);
      expect(mismatch.success).toBe(false);
      if (!mismatch.success) {
        expect(mismatch.error).toEqual({
          type: 'PLAN_CHANGE_QUOTE_STALE',
          reason: 'changed',
        });
      }
      vi.mocked(resolveCheckoutPrice_IO).mockResolvedValue({
        success: true,
        data: { priceId: 'price_refreshed' },
      });
      const refreshed = await confirm(quoted.data.quoteId);
      expect(refreshed.success).toBe(false);
      if (!refreshed.success) {
        expect(refreshed.error).toEqual({
          type: 'PLAN_CHANGE_QUOTE_STALE',
          reason: 'changed',
        });
      }
      noMutation();
    } finally {
      now.mockRestore();
    }
  });
});

vi.mock('./plan-change-lease', async () => import('./plan-change-lease.mock'));
