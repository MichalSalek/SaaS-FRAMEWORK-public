import { grossTargetPrice } from './account-plan-change.quote.fixtures';
import { PLAN_ID_MAP } from '@kernel/domain/stripe/stripe.config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { changePaidPlan_IO } from './account-plan-change.operations';
import { previewPaidPlanChange_IO } from './plan-change-quote.operations';
import { clearPlanChangeQuoteStore } from './plan-change-quote.store';

const leaseState = vi.hoisted(() => ({
  owner: null as string | null,
  live: true,
}));
vi.mock('./checkout-attempt.database', () => ({
  attemptStore: {
    claim: async (_accountId: string, owner: string) => {
      if (leaseState.owner) {
        return null;
      }
      leaseState.owner = owner;
      return {
        lease_owner: owner,
        db_now: new Date(Date.now()),
        lease_expires_at: new Date(Date.now() + 60_000),
      };
    },
    read: async () => ({
      lease_owner: leaseState.owner,
      db_now: new Date(Date.now()),
      lease_expires_at: new Date(Date.now() + (leaseState.live ? 60_000 : -1)),
    }),
    release: async (_accountId: string, owner: string) => {
      if (leaseState.owner === owner) {
        leaseState.owner = null;
      }
    },
  },
}));

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
    leaseState.owner = null;
    leaseState.live = true;
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
  it('does not update Stripe after the account lease is lost', async () => {
    subRetrieve.mockResolvedValue(owned());
    invoicePreview.mockResolvedValue(figures());
    const quoted = await preview();
    if (!quoted.success) {
      throw new Error('preview failed');
    }
    leaseState.live = false;
    expect(
      await changePaidPlan_IO({
        userId: USER_ID,
        targetPlanId: PricingPlanValue.PRO_PLUS,
        billingPeriod: 'month',
        quoteId: quoted.data.quoteId,
      })
    ).toMatchObject({
      success: false,
      error: { type: 'PLAN_CHANGE_QUOTE_STALE', reason: 'changed' },
    });
    noMutation();
  });

  it('blocks legacy unquoted changes while the account lease is held', async () => {
    leaseState.owner = 'another-owner';
    expect(
      await changePaidPlan_IO({
        userId: USER_ID,
        targetPlanId: PricingPlanValue.PRO_PLUS,
        billingPeriod: 'month',
      })
    ).toMatchObject({
      success: false,
      error: { type: 'PLAN_CHANGE_QUOTE_STALE', reason: 'changed' },
    });
    expect(subRetrieve).not.toHaveBeenCalled();
    noMutation();
  });
  it('fails closed when a committed update response is lost', async () => {
    subRetrieve.mockResolvedValue(owned());
    invoicePreview.mockResolvedValue(figures());
    const quoted = await preview();
    if (!quoted.success) {
      throw new Error('preview failed');
    }
    const invoice = {
      id: 'in_quote',
      ...figures(),
      status: 'open',
      amount_remaining: 1290,
      confirmation_secret: { client_secret: 'pi_secret_resurface' },
    };
    subUpdate.mockRejectedValueOnce(new Error('connection lost after commit'));
    const confirm = () =>
      changePaidPlan_IO({
        userId: USER_ID,
        targetPlanId: PricingPlanValue.PRO_PLUS,
        billingPeriod: 'month',
        quoteId: quoted.data.quoteId,
      });
    expect(await confirm()).toMatchObject({
      success: false,
      error: { type: 'ACCOUNT_STRIPE_ERROR' },
    });
    subRetrieve.mockResolvedValue(
      owned({
        pending_update: { subscription_items: [{ price: TARGET_PRICE }] },
        latest_invoice: invoice,
      })
    );
    expect(await confirm()).toMatchObject({
      success: false,
      error: { type: 'PLAN_CHANGE_QUOTE_STALE', reason: 'changed' },
    });
    expect(subUpdate).toHaveBeenCalledTimes(1);
  });
  it('does not apply two concurrently confirmed quotes from the same old subscription state', async () => {
    vi.mocked(resolveCheckoutPrice_IO).mockImplementation(
      async ({ planId }) => ({
        success: true,
        data: {
          priceId:
            planId === PricingPlanValue.STUDIO
              ? 'price_studio_month'
              : TARGET_PRICE,
        },
      })
    );
    subRetrieve.mockResolvedValue(owned());
    invoicePreview.mockResolvedValue(figures());
    const first = await preview();
    const second = await previewPaidPlanChange_IO({
      userId: USER_ID,
      targetPlanId: PricingPlanValue.STUDIO,
      billingPeriod: 'month',
    });
    if (!first.success || !second.success) {
      throw new Error('preview failed');
    }
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>(resolve => {
      release = resolve;
    });
    const started = new Promise<void>(resolve => {
      entered = resolve;
    });
    subUpdate.mockImplementation(async () => {
      entered();
      await blocked;
      return {
        latest_invoice: {
          id: 'in_test',
          ...figures(),
          status: 'paid',
          amount_remaining: 0,
        },
      };
    });
    const firstRequest = changePaidPlan_IO({
      userId: USER_ID,
      targetPlanId: PricingPlanValue.PRO_PLUS,
      billingPeriod: 'month',
      quoteId: first.data.quoteId,
    });
    await started;
    const secondRequest = await changePaidPlan_IO({
      userId: USER_ID,
      targetPlanId: PricingPlanValue.STUDIO,
      billingPeriod: 'month',
      quoteId: second.data.quoteId,
    });
    expect(secondRequest).toMatchObject({
      success: false,
      error: { type: 'PLAN_CHANGE_QUOTE_STALE', reason: 'changed' },
    });
    release();
    await firstRequest;
    const afterWinner = owned();
    itemOf(afterWinner).price = {
      id: TARGET_PRICE,
      currency: 'pln',
      product: { metadata: { planId: PLAN_ID_MAP.PRO_PLUS } },
    };
    subRetrieve.mockResolvedValue(afterWinner);
    const retried = await changePaidPlan_IO({
      userId: USER_ID,
      targetPlanId: PricingPlanValue.STUDIO,
      billingPeriod: 'month',
      quoteId: second.data.quoteId,
    });
    expect(retried).toMatchObject({
      success: false,
      error: { type: 'PLAN_CHANGE_QUOTE_STALE', reason: 'changed' },
    });
    expect(subUpdate).toHaveBeenCalledTimes(1);
    expect(subUpdate).toHaveBeenCalledWith(
      SUB_ID,
      expect.anything(),
      expect.objectContaining({
        idempotencyKey: first.data.quoteId,
        timeout: expect.any(Number),
        maxNetworkRetries: 0,
      })
    );
    expect(leaseState.owner).toBeNull();
  });
});
