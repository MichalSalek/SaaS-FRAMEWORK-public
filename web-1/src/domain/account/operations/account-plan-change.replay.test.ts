import { grossTargetPrice } from './account-plan-change.quote.fixtures';
import { PLAN_ID_MAP } from '@kernel/domain/stripe/stripe.config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { changePaidPlan_IO } from './account-plan-change.operations';
import { previewPaidPlanChange_IO } from './plan-change-quote.operations';
import { clearPlanChangeQuoteStore } from './plan-change-quote.store';

vi.mock('./plan-change-lease', async () => import('./plan-change-lease.mock'));

vi.mock('@app/stripe/price-resolver.operations', () => ({
  resolveCheckoutPrice_IO: vi.fn(async () => ({
    success: true,
    data: { priceId: 'price_proplus_month' },
  })),
}));

const subRetrieve = vi.fn();
const subUpdate = vi.fn();
const invoicePreview = vi.fn();
const priceRetrieve = vi.fn();
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
const SUB_ID = 'sub_test_active';
const TARGET_PRICE = 'price_proplus_month';
const NOW_MS = 1_700_000_100_000;
const PERIOD_END = 1_702_592_000;

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

const owned = (
  patch: Record<string, unknown> = {}
): Record<string, unknown> => ({
  id: SUB_ID,
  status: 'active',
  metadata: { accountId: ACCOUNT_ID },
  discounts: [],
  default_tax_rates: [],
  trial_end: null,
  cancel_at: null,
  cancel_at_period_end: false,
  pending_update: null,
  latest_invoice: null,
  items: {
    data: [
      {
        id: 'si_test_item',
        quantity: 1,
        current_period_start: 1_700_000_000,
        current_period_end: PERIOD_END,
        discounts: [],
        tax_rates: null,
        price: {
          id: 'price_pro_month',
          currency: 'pln',
          recurring: { interval: 'month' },
          product: { metadata: { planId: PLAN_ID_MAP.PRO } },
        },
      },
    ],
  },
  ...patch,
});

const itemOf = (
  subscription: Record<string, unknown>
): Record<string, unknown> => {
  const item = (subscription.items as { data: Record<string, unknown>[] })
    .data[0];
  if (item == null) {
    throw new Error('fixture has no subscription item');
  }
  return item;
};

const figures = (patch: Record<string, unknown> = {}) => ({
  amount_due: 1290,
  total: 1290,
  currency: 'pln',
  total_taxes: [{ amount: 241 }],
  ...patch,
});

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

describe('quoted plan change replay', () => {
  beforeEach(() => {
    clearPlanChangeQuoteStore();
    subRetrieve.mockReset();
    subUpdate.mockReset();
    invoicePreview.mockReset();
    priceRetrieve.mockReset();
    priceRetrieve.mockImplementation(async (id: string) =>
      grossTargetPrice(id)
    );
    invoiceCreate.mockReset();
    invoiceFinalize.mockReset();
    vi.mocked(resolveCheckoutPrice_IO).mockResolvedValue({
      success: true,
      data: { priceId: TARGET_PRICE },
    });
    mockAccount();
  });
  it('replays pending and already-applied quotes without a second update', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(NOW_MS);
    subRetrieve.mockResolvedValue(owned());
    invoicePreview.mockResolvedValue(figures());
    try {
      const quoted = await preview();
      if (!quoted.success) {
        throw new Error('preview failed');
      }
      const actualInvoice = {
        id: 'in_quote',
        ...figures(),
        status: 'open',
        amount_remaining: 1290,
        confirmation_secret: { client_secret: 'pi_secret_resurface' },
      };
      subUpdate.mockResolvedValueOnce({ latest_invoice: actualInvoice });
      await changePaidPlan_IO({
        userId: USER_ID,
        targetPlanId: PricingPlanValue.PRO_PLUS,
        billingPeriod: 'month',
        quoteId: quoted.data.quoteId,
      });
      subRetrieve.mockResolvedValueOnce(
        owned({
          pending_update: { subscription_items: [{ price: TARGET_PRICE }] },
          latest_invoice: actualInvoice,
        })
      );
      const pending = await changePaidPlan_IO({
        userId: USER_ID,
        targetPlanId: PricingPlanValue.PRO_PLUS,
        billingPeriod: 'month',
        quoteId: quoted.data.quoteId,
      });
      expect(pending.success).toBe(true);
      if (pending.success && pending.data.status === 'requires_action') {
        expect(pending.data.clientSecret).toBe('pi_secret_resurface');
      } else {
        throw new Error('expected requires_action');
      }
      const appliedSub = owned();
      itemOf(appliedSub).price = {
        id: TARGET_PRICE,
        currency: 'pln',
        product: { metadata: { planId: PLAN_ID_MAP.PRO_PLUS } },
      };
      (appliedSub as { latest_invoice: unknown }).latest_invoice = {
        ...actualInvoice,
        status: 'paid',
        amount_remaining: 0,
      };
      subRetrieve.mockResolvedValueOnce(appliedSub);
      const applied = await changePaidPlan_IO({
        userId: USER_ID,
        targetPlanId: PricingPlanValue.PRO_PLUS,
        billingPeriod: 'month',
        quoteId: quoted.data.quoteId,
      });
      expect(applied.success).toBe(true);
      if (applied.success) {
        expect(applied.data.status).toBe('completed');
      }
      expect(subUpdate).toHaveBeenCalledTimes(1);
      expect(invoiceCreate).not.toHaveBeenCalled();
      expect(invoiceFinalize).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
  });
  it('quotes the existing pending invoice and rejects a changed or unrelated SCA invoice', async () => {
    const invoice = {
      id: 'in_pending',
      ...figures(),
      status: 'open',
      amount_remaining: 1290,
      confirmation_secret: { client_secret: 'pi_pending' },
    };
    const pending = owned({
      pending_update: { subscription_items: [{ price: TARGET_PRICE }] },
      latest_invoice: invoice,
    });
    subRetrieve.mockResolvedValue(pending);
    const quoted = await preview();
    if (!quoted.success) {
      throw new Error('pending preview failed');
    }
    expect(quoted.data.amountDue).toBe(1290);
    expect(invoicePreview).not.toHaveBeenCalled();
    const confirm = () =>
      changePaidPlan_IO({
        userId: USER_ID,
        targetPlanId: PricingPlanValue.PRO_PLUS,
        billingPeriod: 'month',
        quoteId: quoted.data.quoteId,
      });
    expect(await confirm()).toMatchObject({
      success: true,
      data: { status: 'requires_action' },
    });
    for (const patch of [
      { id: 'in_other' },
      { amount_due: 9999, total: 9999 },
      { currency: 'usd' },
    ]) {
      subRetrieve.mockResolvedValueOnce({
        ...pending,
        latest_invoice: { ...invoice, ...patch },
      });
      expect(await confirm()).toMatchObject({
        success: false,
        error: { type: 'PLAN_CHANGE_QUOTE_STALE' },
      });
    }
    noMutation();
  });

  it('never substitutes an unrelated pending invoice for a fresh non-pending estimate', async () => {
    subRetrieve.mockResolvedValue(owned());
    invoicePreview.mockResolvedValue(figures());
    const quoted = await preview();
    if (!quoted.success) {
      throw new Error('preview failed');
    }
    subRetrieve.mockResolvedValue(
      owned({
        pending_update: { subscription_items: [{ price: TARGET_PRICE }] },
        latest_invoice: {
          id: 'in_other',
          ...figures(),
          amount_remaining: 1290,
          status: 'open',
          confirmation_secret: { client_secret: 'pi_other' },
        },
      })
    );
    expect(
      await changePaidPlan_IO({
        userId: USER_ID,
        targetPlanId: PricingPlanValue.PRO_PLUS,
        billingPeriod: 'month',
        quoteId: quoted.data.quoteId,
      })
    ).toMatchObject({
      success: false,
      error: { type: 'PLAN_CHANGE_QUOTE_STALE' },
    });
    noMutation();
  });
  it('preserves a scheduled cancellation by refusing a billing period change, with no mutation', async () => {
    subRetrieve.mockResolvedValue(
      owned({ cancel_at_period_end: true, cancel_at: PERIOD_END })
    );
    expect(
      await previewPaidPlanChange_IO({
        userId: USER_ID,
        targetPlanId: PricingPlanValue.PRO_PLUS,
        billingPeriod: 'year',
      })
    ).toMatchObject({
      success: false,
      error: { type: 'PLAN_CHANGE_QUOTE_STALE', reason: 'canceling' },
    });
    expect(invoicePreview).not.toHaveBeenCalled();
    noMutation();
  });
  it('does not report a positive quoted charge completed without its invoice', async () => {
    subRetrieve.mockResolvedValue(owned());
    invoicePreview.mockResolvedValue(figures());
    subUpdate.mockResolvedValue({ latest_invoice: null });
    const quoted = await preview();
    if (!quoted.success) {
      throw new Error('preview failed');
    }
    expect(
      await changePaidPlan_IO({
        userId: USER_ID,
        targetPlanId: PricingPlanValue.PRO_PLUS,
        billingPeriod: 'month',
        quoteId: quoted.data.quoteId,
      })
    ).toMatchObject({
      success: true,
      data: { status: 'payment_failed', reason: 'invoice_missing' },
    });
  });
});
