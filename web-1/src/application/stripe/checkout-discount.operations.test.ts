import { beforeEach, describe, expect, it, vi } from 'vitest';

const list = vi.fn();

vi.mock('@app/stripe/adapters/stripe.adapter', () => ({
  getStripe: () => ({ promotionCodes: { list } }),
}));
vi.mock('@app/environment/environment.config', () => ({
  ENV_VARS: { STRIPE_TEST_COUPON_ID: '' },
}));
vi.mock('@app/stripe/launch-offer.operations', () => ({
  getLaunchOfferCheckoutDiscount: async () => null,
}));

import { resolveCheckoutDiscounts_IO } from './checkout-discount.operations';

const usableCode = {
  id: 'promo_1',
  promotion: { type: 'coupon', coupon: '<stripe-coupon-id>' },
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  max_redemptions: 1,
  times_redeemed: 0,
  customer: 'cus_1',
  active: true,
};

describe('resolveCheckoutDiscounts_IO (first-month code)', () => {
  beforeEach(() => {
    list.mockReset();
    list.mockResolvedValue({ data: [usableCode] });
  });

  it('applies a valid code to a monthly checkout without a trial', async () => {
    const decision = await resolveCheckoutDiscounts_IO({
      billingPeriod: 'month',
      promo: 'ANNA-7K2Q',
      stripeCustomerId: 'cus_1',
      trialEligible: false,
    });
    expect(decision.discounts).toEqual([{ promotion_code: 'promo_1' }]);
  });

  it('ignores the code on a yearly price (a once-coupon would discount the whole year)', async () => {
    const decision = await resolveCheckoutDiscounts_IO({
      billingPeriod: 'year',
      promo: 'ANNA-7K2Q',
      stripeCustomerId: 'cus_1',
      trialEligible: false,
    });
    expect(decision.discounts).toBeUndefined();
    expect(list).not.toHaveBeenCalled();
  });

  it('ignores the code when the session starts a trial (zero invoice would consume it)', async () => {
    const decision = await resolveCheckoutDiscounts_IO({
      billingPeriod: 'month',
      promo: 'ANNA-7K2Q',
      stripeCustomerId: 'cus_1',
      trialEligible: true,
    });
    expect(decision.discounts).toBeUndefined();
  });

  it('rejects a code restricted to another customer', async () => {
    const decision = await resolveCheckoutDiscounts_IO({
      billingPeriod: 'month',
      promo: 'ANNA-7K2Q',
      stripeCustomerId: 'cus_other',
      trialEligible: false,
    });
    expect(decision.promoRejected).toBe(true);
    expect(decision.discounts).toBeUndefined();
  });
});
