import { describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import {
  pendingSubscriptionPayment,
  subscriptionDiscounts,
} from './subscription-billing.details';
import { isStripeHostedInvoiceUrl } from '@kernel/domain/stripe/hosted-invoice-url';
type Sub = Parameters<typeof pendingSubscriptionPayment>[0];
type Invoice = Exclude<NonNullable<Sub['latest_invoice']>, string>;
const NOW = 1_700_000_000_000;
const invoice = (patch: Partial<Invoice> = {}): Invoice => ({
  id: 'in_owned',
  status: 'open',
  amount_remaining: 1200,
  currency: 'pln',
  hosted_invoice_url: 'https://invoice.stripe.com/i/owned',
  parent: {
    type: 'subscription_details',
    quote_details: null,
    subscription_details: { metadata: null, subscription: 'sub_owned' },
  },
  ...patch,
});
const sub = (patch: Partial<Sub> = {}): Sub => ({
  id: 'sub_owned',
  status: 'active',
  latest_invoice: invoice(),
  pending_update: { expires_at: NOW / 1000 + 60 },
  ...patch,
});
const coupon = (patch: Partial<Stripe.Coupon> = {}): Stripe.Coupon => ({
  id: 'co_owned',
  object: 'coupon',
  created: NOW / 1000,
  amount_off: null,
  currency: null,
  duration: 'forever',
  duration_in_months: null,
  livemode: false,
  max_redemptions: 1,
  metadata: {},
  name: 'Owner discount',
  percent_off: 100,
  redeem_by: null,
  times_redeemed: 1,
  valid: false,
  ...patch,
});
const discount = (patch: Partial<Stripe.Discount> = {}): Stripe.Discount => ({
  id: 'di_owned',
  object: 'discount',
  checkout_session: null,
  customer: 'cus_owned',
  customer_account: null,
  end: null,
  invoice: null,
  invoice_item: null,
  promotion_code: null,
  source: { type: 'coupon', coupon: coupon() },
  start: NOW / 1000,
  subscription: 'sub_owned',
  subscription_item: null,
  ...patch,
});
describe('existing hosted invoice recovery', () => {
  it.each([
    'https://evil.example/i/owned',
    'https://invoice.stripe.com.evil.example/i/owned',
    'http://invoice.stripe.com/i/owned',
    'https://invoice.stripe.com:8443/i/owned',
    'https://user@invoice.stripe.com/i/owned',
    'javascript:alert(1)',
    'https://invoice.stripe.com/not-invoice',
  ])('rejects an untrusted destination %s', url => {
    expect(isStripeHostedInvoiceUrl(url)).toBe(false);
    expect(
      pendingSubscriptionPayment(
        sub({ latest_invoice: invoice({ hosted_invoice_url: url }) }),
        NOW
      )
    ).toBeNull();
  });
  it.each(['active', 'trialing', 'past_due', 'incomplete'] as const)(
    'restores the owned invoice on %s',
    status => {
      expect(pendingSubscriptionPayment(sub({ status }), NOW)).toMatchObject({
        invoiceId: 'in_owned',
        amountRemaining: 1200,
        expiresAt: new Date(NOW + 60_000).toISOString(),
      });
    }
  );
  it('uses the unpaid remainder and does not require a pending plan update for a first invoice', () => {
    expect(
      pendingSubscriptionPayment(
        sub({
          pending_update: null,
          latest_invoice: invoice({ amount_remaining: 500 }),
        }),
        NOW
      )
    ).toMatchObject({ amountRemaining: 500, expiresAt: null });
  });
  it.each(['paid', 'void', 'draft', 'uncollectible'] as const)(
    'hides an invoice in state %s',
    status => {
      expect(
        pendingSubscriptionPayment(
          sub({ latest_invoice: invoice({ status }) }),
          NOW
        )
      ).toBeNull();
    }
  );
  it('hides expired and terminal subscriptions, zero amounts and unexpanded invoices', () => {
    for (const input of [
      sub({ pending_update: { expires_at: NOW / 1000 } }),
      sub({ status: 'canceled' }),
      sub({ status: 'incomplete_expired' }),
      sub({ latest_invoice: 'in_owned' }),
      sub({ latest_invoice: invoice({ amount_remaining: 0 }) }),
      sub({ latest_invoice: invoice({ amount_remaining: 0.5 }) }),
    ]) {
      expect(pendingSubscriptionPayment(input, NOW)).toBeNull();
    }
  });
  it('rejects a foreign invoice parent and an invoice without subscription proof', () => {
    expect(
      pendingSubscriptionPayment(sub({ id: 'sub_other' }), NOW)
    ).toBeNull();
    expect(
      pendingSubscriptionPayment(
        sub({ latest_invoice: invoice({ parent: null }) }),
        NOW
      )
    ).toBeNull();
  });
});
describe('applied subscription discount details', () => {
  it('keeps an already applied forever coupon even after its redemption limit was used', () => {
    expect(subscriptionDiscounts([discount()], NOW)).toEqual([
      {
        name: 'Owner discount',
        percentOff: 100,
        amountOff: null,
        currency: null,
        duration: 'forever',
        endsAt: null,
      },
    ]);
  });
  it('keeps one-time and date-limited discounts distinct from forever', () => {
    for (const duration of ['once', 'repeating'] as const) {
      const d = discount({
        end: NOW / 1000 + 60,
        source: { type: 'coupon', coupon: coupon({ duration }) },
      });
      expect(subscriptionDiscounts([d], NOW)[0]).toMatchObject({
        duration,
        endsAt: new Date(NOW + 60_000).toISOString(),
      });
    }
  });
  it('does not label missing, expired or unexpanded coupons as a discount', () => {
    expect(
      subscriptionDiscounts(
        [
          'di_unexpanded',
          discount({ end: NOW / 1000 }),
          discount({ source: { type: 'coupon', coupon: 'co_unexpanded' } }),
        ],
        NOW
      )
    ).toEqual([]);
  });
  it('supports an amount coupon and hides a coupon for another product', () => {
    const d = discount({
      source: {
        type: 'coupon',
        coupon: coupon({
          percent_off: null,
          amount_off: 1900,
          currency: 'pln',
          applies_to: { products: ['prod_owned'] },
        }),
      },
    });
    expect(subscriptionDiscounts([d], NOW, 'prod_other', 'pln')).toEqual([]);
    expect(
      subscriptionDiscounts([d], NOW, 'prod_owned', 'pln')[0]
    ).toMatchObject({
      amountOff: 1900,
      currency: 'pln',
      percentOff: null,
    });
  });
  it.each([
    ['pln', 1000],
    ['eur', 200],
    ['usd', 300],
  ])(
    'uses the %s amount from a multicurrency coupon',
    (currency, amountOff) => {
      const d = discount({
        source: {
          type: 'coupon',
          coupon: coupon({
            percent_off: null,
            amount_off: 1000,
            currency: 'pln',
            currency_options: {
              eur: { amount_off: 200 },
              usd: { amount_off: 300 },
            },
          }),
        },
      });
      expect(
        subscriptionDiscounts([d], NOW, undefined, currency)
      ).toMatchObject([{ amountOff, currency, percentOff: null }]);
    }
  );
  it('omits fixed discounts without a verified amount for the subscription currency', () => {
    for (const options of [
      undefined,
      {},
      { usd: { amount_off: 300 } },
      { eur: { amount_off: 0 } },
      { eur: { amount_off: -1 } },
      { eur: { amount_off: 1.5 } },
      { eur: { amount_off: Number.MAX_SAFE_INTEGER + 1 } },
    ]) {
      const d = discount({
        source: {
          type: 'coupon',
          coupon: coupon({
            percent_off: null,
            amount_off: 1000,
            currency: 'pln',
            ...(options === undefined ? {} : { currency_options: options }),
          }),
        },
      });
      expect(subscriptionDiscounts([d], NOW, undefined, 'eur')).toEqual([]);
    }
  });
  it('omits invalid default amounts or an unknown subscription currency', () => {
    for (const amount of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const d = discount({
        source: {
          type: 'coupon',
          coupon: coupon({
            percent_off: null,
            amount_off: amount,
            currency: 'pln',
          }),
        },
      });
      expect(subscriptionDiscounts([d], NOW, undefined, 'pln')).toEqual([]);
    }
    const d = discount({
      source: {
        type: 'coupon',
        coupon: coupon({
          percent_off: null,
          amount_off: 1000,
          currency: 'pln',
        }),
      },
    });
    expect(subscriptionDiscounts([d], NOW)).toEqual([]);
    expect(
      subscriptionDiscounts([d], NOW, undefined, 'not-a-currency')
    ).toEqual([]);
  });
  it('preserves percentage discounts and resolves multiple fixed coupons independently', () => {
    const fixed = (amount: number) =>
      discount({
        source: {
          type: 'coupon',
          coupon: coupon({
            percent_off: null,
            amount_off: 1000,
            currency: 'pln',
            currency_options: { eur: { amount_off: amount } },
          }),
        },
      });
    expect(
      subscriptionDiscounts(
        [discount(), fixed(200), fixed(300)],
        NOW,
        undefined,
        'eur'
      )
    ).toMatchObject([
      { percentOff: 100, amountOff: null },
      { percentOff: null, amountOff: 200, currency: 'eur' },
      { percentOff: null, amountOff: 300, currency: 'eur' },
    ]);
  });
});
