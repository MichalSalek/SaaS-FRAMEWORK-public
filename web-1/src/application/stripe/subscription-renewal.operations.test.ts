import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAN_ID_MAP } from '@kernel/domain/stripe/stripe.config';

const { retrieve, preview } = vi.hoisted(() => ({
  retrieve: vi.fn(),
  preview: vi.fn(),
}));
vi.mock('./adapters/stripe.adapter', () => ({
  getStripe: () => ({
    subscriptions: { retrieve },
    invoices: { createPreview: preview },
  }),
}));
import {
  readSubscriptionBilling_IO,
  readSubscriptionRenewal_IO,
} from './subscription-billing.operations';

const periodEnd = 1800000000;
const window = {
  start: new Date((periodEnd - 60) * 1000),
  end: new Date((periodEnd + 60) * 1000),
};
const subscription = (planId: string = PLAN_ID_MAP.STUDIO) => ({
  id: 'sub_owned',
  metadata: { accountId: 'account-owned' },
  status: 'active',
  collection_method: 'charge_automatically',
  pause_collection: null,
  cancel_at_period_end: false,
  cancel_at: null,
  pending_update: null,
  latest_invoice: null,
  discounts: [],
  items: {
    data: [
      {
        current_period_end: periodEnd,
        price: {
          currency: 'pln',
          recurring: { interval: 'year' },
          product: { id: 'prod_nf', metadata: { planId } },
        },
      },
    ],
  },
});

describe('fresh renewal preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    retrieve.mockResolvedValue(subscription());
    preview.mockResolvedValue({ amount_due: 12765, currency: 'pln' });
  });

  it.each([12765, 0])(
    'returns Stripe amount_due %i, including a real zero',
    async amount => {
      preview.mockResolvedValue({ amount_due: amount, currency: 'pln' });
      expect(
        await readSubscriptionRenewal_IO('sub_owned', 'account-owned', window)
      ).toEqual({
        kind: 'available',
        amountMinor: amount,
        currency: 'pln',
        nextChargeAt: new Date(periodEnd * 1000).toISOString(),
        planId: PLAN_ID_MAP.STUDIO,
      });
      expect(preview).toHaveBeenCalledTimes(1);
      expect(preview).toHaveBeenCalledWith(
        { subscription: 'sub_owned' },
        { timeout: 2000, maxNetworkRetries: 0 }
      );
    }
  );

  it.each([
    ['cancellation at period end', { cancel_at_period_end: true }],
    ['scheduled cancellation', { cancel_at: periodEnd }],
    ['trial', { status: 'trialing' }],
    ['past due', { status: 'past_due' }],
    ['pending update', { pending_update: { expires_at: periodEnd } }],
    [
      'unpaid invoice',
      { latest_invoice: { status: 'open', amount_remaining: 100 } },
    ],
  ])('skips %s before preview', async (_label, changes) => {
    retrieve.mockResolvedValue({ ...subscription(), ...changes });
    expect(
      (await readSubscriptionRenewal_IO('sub_owned', 'account-owned', window))
        .kind
    ).toBe('not_renewing');
    expect(preview).not.toHaveBeenCalled();
  });

  it.each([
    ['manual collection', { collection_method: 'send_invoice' }],
    ['indefinite pause', { pause_collection: { resumes_at: null } }],
    ['pause through renewal', { pause_collection: { resumes_at: periodEnd } }],
    [
      'pause beyond renewal',
      { pause_collection: { resumes_at: periodEnd + 1 } },
    ],
  ])('does not preview %s', async (_label, changes) => {
    retrieve.mockResolvedValue({ ...subscription(), ...changes });
    expect(
      (await readSubscriptionRenewal_IO('sub_owned', 'account-owned', window))
        .kind
    ).toBe('not_renewing');
    expect(preview).not.toHaveBeenCalled();
  });

  it('previews when collection resumes before renewal', async () => {
    retrieve.mockResolvedValue({
      ...subscription(),
      pause_collection: { resumes_at: periodEnd - 1 },
    });
    expect(
      (await readSubscriptionRenewal_IO('sub_owned', 'account-owned', window))
        .kind
    ).toBe('available');
    expect(preview).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['missing collection method', { collection_method: undefined }],
    ['unknown collection method', { collection_method: 'unknown' }],
    ['missing resume time', { pause_collection: {} }],
    ['invalid resume time', { pause_collection: { resumes_at: -1 } }],
    ['fractional resume time', { pause_collection: { resumes_at: 1.5 } }],
    ['non-numeric resume time', { pause_collection: { resumes_at: 'soon' } }],
  ])('treats %s as unavailable before preview', async (_label, changes) => {
    retrieve.mockResolvedValue({ ...subscription(), ...changes });
    expect(
      (await readSubscriptionRenewal_IO('sub_owned', 'account-owned', window))
        .kind
    ).toBe('unavailable');
    expect(preview).not.toHaveBeenCalled();
  });

  it('skips a changed Stripe renewal date outside the same window', async () => {
    const result = await readSubscriptionRenewal_IO(
      'sub_owned',
      'account-owned',
      {
        start: new Date((periodEnd + 1) * 1000),
        end: new Date((periodEnd + 3600) * 1000),
      }
    );
    expect(result.kind).toBe('not_renewing');
    expect(preview).not.toHaveBeenCalled();
  });

  it('accepts a date at each boundary', async () => {
    const atEnd = new Date(periodEnd * 1000);
    expect(
      (
        await readSubscriptionRenewal_IO('sub_owned', 'account-owned', {
          start: atEnd,
          end: atEnd,
        })
      ).kind
    ).toBe('available');
  });

  it('rejects another owner, foreign product, and missing subscription without preview', async () => {
    expect(
      (await readSubscriptionRenewal_IO('sub_owned', 'other', window)).kind
    ).toBe('invalid');
    retrieve.mockResolvedValue(subscription('other-product'));
    expect(
      (await readSubscriptionRenewal_IO('sub_owned', 'account-owned', window))
        .kind
    ).toBe('invalid');
    retrieve.mockResolvedValue(subscription('app-price-unknown'));
    expect(
      (await readSubscriptionRenewal_IO('sub_owned', 'account-owned', window))
        .kind
    ).toBe('invalid');
    retrieve.mockRejectedValue({ code: 'resource_missing' });
    expect(
      (await readSubscriptionRenewal_IO('sub_missing', 'account-owned', window))
        .kind
    ).toBe('invalid');
    expect(preview).not.toHaveBeenCalled();
  });

  it.each([
    { amount_due: -1, currency: 'pln' },
    { amount_due: 1.5, currency: 'pln' },
    { amount_due: 100, currency: 'usd' },
    { amount_due: 100, currency: 'invalid' },
  ])('does not invent a price for invalid preview %o', async invoice => {
    preview.mockResolvedValue(invoice);
    expect(
      (await readSubscriptionRenewal_IO('sub_owned', 'account-owned', window))
        .kind
    ).toBe('unavailable');
  });

  it('treats timeouts and missing ids as unavailable', async () => {
    preview.mockRejectedValue(new Error('timeout'));
    expect(
      (await readSubscriptionRenewal_IO('sub_owned', 'account-owned', window))
        .kind
    ).toBe('unavailable');
    expect(
      (await readSubscriptionRenewal_IO(null, 'account-owned', window)).kind
    ).toBe('unavailable');
  });
  it('does not preview an unexpanded latest invoice', async () => {
    retrieve.mockResolvedValue({
      ...subscription(),
      latest_invoice: 'in_unexpanded',
    });
    expect(
      (await readSubscriptionRenewal_IO('sub_owned', 'account-owned', window))
        .kind
    ).toBe('unavailable');
    expect(preview).not.toHaveBeenCalled();
  });
  it.each([NaN, Infinity, 0, 1.5])(
    'does not preview an invalid renewal timestamp %s',
    async timestamp => {
      const value = subscription();
      const item = value.items.data[0];
      if (item === undefined) {
        throw new Error('Missing test item');
      }
      item.current_period_end = timestamp;
      retrieve.mockResolvedValue(value);
      expect(
        (await readSubscriptionRenewal_IO('sub_owned', 'account-owned', window))
          .kind
      ).toBe('unavailable');
      expect(preview).not.toHaveBeenCalled();
    }
  );
  it('never previews a subscription with multiple items', async () => {
    const value = subscription();
    const item = value.items.data[0];
    if (item === undefined) {
      throw new Error('Missing test item');
    }
    value.items.data.push(item);
    retrieve.mockResolvedValue(value);
    expect(
      (await readSubscriptionRenewal_IO('sub_owned', 'account-owned', window))
        .kind
    ).toBe('invalid');
    expect(preview).not.toHaveBeenCalled();
  });
  it('does not reuse the cached public billing preview', async () => {
    preview.mockResolvedValueOnce({ amount_due: 6000, currency: 'pln' });
    expect(
      (await readSubscriptionBilling_IO('sub_owned', 'account-owned'))
        ?.nextChargeAmount
    ).toBe(6000);
    preview.mockResolvedValueOnce({ amount_due: 12765, currency: 'pln' });
    const fresh = await readSubscriptionRenewal_IO(
      'sub_owned',
      'account-owned',
      window
    );
    expect(fresh.kind === 'available' && fresh.amountMinor).toBe(12765);
    expect(preview).toHaveBeenCalledTimes(2);
  });
});
