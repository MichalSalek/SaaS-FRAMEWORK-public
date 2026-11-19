import { PLAN_ID_MAP } from '@kernel/domain/stripe/stripe.config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { retrieve, preview } = vi.hoisted(() => ({
  retrieve: vi.fn(),
  preview: vi.fn(),
}));
vi.mock('@app/cache/cache.utils', () => ({
  createCache: () => ({ get: () => null, set: vi.fn() }),
}));
vi.mock('./adapters/stripe.adapter', () => ({
  getStripe: () => ({
    subscriptions: { retrieve },
    invoices: { createPreview: preview },
  }),
}));
import { readSubscriptionBilling_IO } from './subscription-billing.operations';

const subscription = (planId: string = PLAN_ID_MAP.STUDIO) => ({
  metadata: { accountId: 'account-owned' },
  status: 'trialing',
  cancel_at_period_end: false,
  cancel_at: null,
  trial_end: 1800000000,
  items: {
    data: [
      {
        current_period_end: 1800000000,
        price: {
          currency: 'pln',
          recurring: { interval: 'month' },
          product: { metadata: { planId } },
        },
      },
    ],
  },
});
describe('scoped subscription billing preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    retrieve.mockResolvedValue(subscription());
    preview.mockResolvedValue({ amount_due: 12300, currency: 'pln' });
  });
  it('reads the upcoming gross charge and trial-end date', async () => {
    expect(
      await readSubscriptionBilling_IO('sub_owned', 'account-owned')
    ).toEqual({
      nextChargeAmount: 12300,
      currency: 'pln',
      nextChargeAt: new Date(1800000000 * 1000).toISOString(),
      billingPeriod: 'monthly',
    });
    expect(preview).toHaveBeenCalledWith(
      { subscription: 'sub_owned' },
      { timeout: 2000, maxNetworkRetries: 0 }
    );
  });
  it('reads all coupon currency options in the subscription request and serializes each in the item currency', async () => {
    const existing = subscription();
    const item = existing.items.data[0];
    if (!item) {
      throw new Error('Expected subscription item fixture');
    }
    item.price.currency = 'eur';
    const fixed = (amount: number) => ({
      end: null,
      source: {
        coupon: {
          name: 'Fixed',
          percent_off: null,
          amount_off: 1000,
          currency: 'pln',
          currency_options: { eur: { amount_off: amount } },
          duration: 'forever',
        },
      },
    });
    retrieve.mockResolvedValue({
      ...existing,
      discounts: [fixed(200), fixed(300)],
    });
    preview.mockResolvedValue({ amount_due: 1900, currency: 'eur' });
    const result = await readSubscriptionBilling_IO(
      'sub_eur_coupons',
      'account-owned'
    );
    expect(result?.discounts).toMatchObject([
      { amountOff: 200, currency: 'eur' },
      { amountOff: 300, currency: 'eur' },
    ]);
    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(retrieve.mock.calls[0]?.[1].expand).toContain(
      'discounts.source.coupon.currency_options'
    );
  });
  it('never previews a product outside the plan catalogue', async () => {
    retrieve.mockResolvedValue(subscription('foreign-product'));
    expect(
      await readSubscriptionBilling_IO('sub_foreign', 'account-owned')
    ).toBeNull();
    expect(preview).not.toHaveBeenCalled();
  });
  it('never previews a subscription belonging to another Nailfolio account', async () => {
    expect(
      await readSubscriptionBilling_IO('sub_foreign', 'other-account')
    ).toBeNull();
    expect(preview).not.toHaveBeenCalled();
  });
  it('a pending cancellation promises no charge', async () => {
    retrieve.mockResolvedValue({
      ...subscription(),
      cancel_at_period_end: true,
    });
    expect(
      (await readSubscriptionBilling_IO('sub_owned', 'account-owned'))
        ?.nextChargeAmount
    ).toBeNull();
    expect(preview).not.toHaveBeenCalled();
  });
  it('failure stays unavailable rather than inventing a price', async () => {
    preview.mockRejectedValue(new Error('Stripe unavailable'));
    expect(
      await readSubscriptionBilling_IO('sub_owned', 'account-owned')
    ).toBeNull();
  });
});
