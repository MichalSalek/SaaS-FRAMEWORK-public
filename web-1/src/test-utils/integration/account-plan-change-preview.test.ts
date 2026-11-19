import { PLAN_ID_MAP } from '@kernel/domain/stripe/stripe.config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import previewHandler from '../../pages/api/v1/account/plan-change-preview';
import { resolveCheckoutPrice_IO } from '@app/stripe/price-resolver.operations';
import { mockApiHandler, mockDb } from '../mockApiHandler';
import { __setCurrentUser, __setPermission } from '../setup';
import { makeCurrentUserOutput, makeStylistCurrentUser } from '../fixtures';

const subRetrieve = vi.fn();
const subUpdate = vi.fn();
const invoicePreview = vi.fn();
const invoiceCreate = vi.fn();
const invoiceFinalize = vi.fn();

vi.mock('@app/stripe/adapters/stripe.adapter', () => ({
  getStripe: () => ({
    subscriptions: { retrieve: subRetrieve, update: subUpdate },
    prices: {
      retrieve: vi.fn(async () => ({
        id: 'price_proplus_month',
        currency: 'pln',
        billing_scheme: 'per_unit',
        tax_behavior: 'inclusive',
        unit_amount: 4900,
      })),
    },
    invoices: {
      createPreview: invoicePreview,
      create: invoiceCreate,
      finalizeInvoice: invoiceFinalize,
    },
  }),
}));

vi.mock('@app/stripe/price-resolver.operations', () => ({
  resolveCheckoutPrice_IO: vi.fn(async () => ({
    success: true,
    data: { priceId: 'price_proplus_month' },
  })),
}));

const subscription = {
  id: 'sub_preview_secret',
  status: 'active',
  metadata: { accountId: 'acc_test_0000000000000001' },
  discounts: [],
  default_tax_rates: [],
  trial_end: null,
  cancel_at: null,
  cancel_at_period_end: false,
  pending_update: null,
  items: {
    data: [
      {
        id: 'si_preview',
        quantity: 1,
        current_period_start: 1_700_000_000,
        current_period_end: 1_702_592_000,
        discounts: [],
        tax_rates: null,
        price: {
          id: 'price_pro_month',
          currency: 'pln',
          product: { metadata: { planId: PLAN_ID_MAP.PRO } },
        },
      },
    ],
  },
};

describe('GET account/plan-change-preview', () => {
  beforeEach(() => {
    __setPermission(true);
    __setCurrentUser(makeCurrentUserOutput(makeStylistCurrentUser()));
    mockDb({
      user: {
        findUnique: async () => ({
          stylist_account: {
            account_id: 'acc_test_0000000000000001',
            subscription_id: 'sub_preview_secret',
          },
        }),
      },
    });
    subRetrieve.mockReset();
    subUpdate.mockReset();
    invoicePreview.mockReset();
    invoiceCreate.mockReset();
    invoiceFinalize.mockReset();
    subRetrieve.mockResolvedValue(subscription);
    invoicePreview.mockResolvedValue({
      amount_due: 0,
      total: -400,
      currency: 'pln',
      total_taxes: null,
    });
  });

  it('returns the gross preview and does not mutate Stripe', async () => {
    const { status, event, data, raw } = await mockApiHandler<{
      quoteId: string;
      amountDue: number;
      total: number;
      taxAmount: number | null;
      currency: string;
      billingPeriod: string;
      regularAmount: number;
    }>(previewHandler, {
      method: 'GET',
      url: '/api/v1/account/plan-change-preview',
      query: {
        targetPlanId: PricingPlanValue.PRO_PLUS,
        billingPeriod: 'month',
      },
    });
    expect(status).toBe(200);
    expect(event).toBe('SUCCESS');
    expect(data.amountDue).toBe(0);
    expect(data.total).toBe(-400);
    expect(data.taxAmount).toBeNull();
    expect(data.currency).toBe('pln');
    expect(data.billingPeriod).toBe('month');
    expect(data.regularAmount).toBe(4900);
    expect(data.quoteId).toEqual(expect.any(String));
    expect(JSON.stringify(raw)).not.toContain('sub_preview_secret');
    expect(resolveCheckoutPrice_IO).toHaveBeenCalledWith({
      planId: PricingPlanValue.PRO_PLUS,
      billingPeriod: 'month',
      currency: 'pln',
    });
    expect(invoicePreview).toHaveBeenCalledTimes(1);
    expect(subUpdate).not.toHaveBeenCalled();
    expect(invoiceCreate).not.toHaveBeenCalled();
    expect(invoiceFinalize).not.toHaveBeenCalled();
  });

  it('rejects an unknown billing period before Stripe', async () => {
    const { status, event } = await mockApiHandler(previewHandler, {
      method: 'GET',
      url: '/api/v1/account/plan-change-preview',
      query: { targetPlanId: PricingPlanValue.PRO_PLUS, billingPeriod: 'week' },
    });
    expect(status).toBe(400);
    expect(event).toBe('VALIDATION_FAILED');
    expect(subRetrieve).not.toHaveBeenCalled();
    expect(invoicePreview).not.toHaveBeenCalled();
    expect(subUpdate).not.toHaveBeenCalled();
  });
});
