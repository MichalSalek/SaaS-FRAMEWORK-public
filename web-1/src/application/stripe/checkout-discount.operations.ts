/**
 * One discount slot on a Checkout Session.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Stripe Checkout accepts a single discount. Precedence is explicit:
 * 1. QA coupon (STRIPE_TEST_COUPON_ID) wins and the request promo is ignored.
 * 2. A valid first-month promotion code (EMAIL_OFFERS.FIRST_MONTH) is applied.
 * 3. Otherwise the launch offer, when its window is open.
 * An invalid or expired promo does NOT fall through to the launch offer.
 * Checkout still succeeds at full price and the response sets promoRejected.
 */

import type Stripe from 'stripe';
import { EMAIL_OFFERS } from '@kernel/domain/stripe/stripe.config';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';
import { ENV_VARS } from '@app/environment/environment.config';
import { getStripe } from '@app/stripe/adapters/stripe.adapter';
import { getLaunchOfferCheckoutDiscount } from '@app/stripe/launch-offer.operations';

export type CheckoutDiscountDecision = {
  discounts?: Stripe.Checkout.SessionCreateParams.Discount[];
  promoRejected: boolean;
};

const couponIdOf = (promo: Stripe.PromotionCode): string | null => {
  const coupon = promo.promotion?.coupon;
  if (typeof coupon === 'string') {
    return coupon;
  }
  if (coupon && typeof coupon === 'object' && 'id' in coupon) {
    return coupon.id;
  }
  return null;
};

const customerIdOf = (promo: Stripe.PromotionCode): string | null => {
  const customer = promo.customer;
  if (customer == null) {
    return null;
  }
  if (typeof customer === 'string') {
    return customer;
  }
  return customer.id;
};

const isUsableFirstMonthCode = (
  promo: Stripe.PromotionCode,
  stripeCustomerId: string
): boolean => {
  if (couponIdOf(promo) !== EMAIL_OFFERS.FIRST_MONTH.couponId) {
    return false;
  }
  if (promo.expires_at !== null && promo.expires_at * 1000 <= Date.now()) {
    return false;
  }
  if (
    promo.max_redemptions !== null &&
    promo.times_redeemed >= promo.max_redemptions
  ) {
    return false;
  }
  const restrictedTo = customerIdOf(promo);
  if (restrictedTo !== null && restrictedTo !== stripeCustomerId) {
    return false;
  }
  return true;
};

export const resolveCheckoutDiscounts_IO = async (args: {
  billingPeriod: BillingPeriod;
  promo: string | undefined;
  stripeCustomerId: string;
  /** The session starts a free trial (canStartTrial). */
  trialEligible: boolean;
}): Promise<CheckoutDiscountDecision> => {
  const qaCouponId = ENV_VARS.STRIPE_TEST_COUPON_ID;
  if (qaCouponId) {
    return { discounts: [{ coupon: qaCouponId }], promoRejected: false };
  }

  // DECISION (nie usuwaj tego komentarza): the first-month code is a
  // `duration: once` coupon, so it is honoured ONLY for a monthly plan without
  // a trial. On a yearly price `once` discounts the WHOLE first year (20% of
  // an annual invoice instead of one month, found in the S122 review); with a
  // trial the first invoice is the zero-amount trial invoice, which would
  // consume the single use. In both cases the session is minted at the
  // regular price and the code stays unused for a later monthly checkout.
  const code =
    args.billingPeriod === 'month' && !args.trialEligible
      ? args.promo?.trim()
      : undefined;
  if (code) {
    try {
      const listed = await getStripe().promotionCodes.list({
        code,
        active: true,
        limit: 10,
      });
      const match = listed.data.find(promo =>
        isUsableFirstMonthCode(promo, args.stripeCustomerId)
      );
      if (match) {
        return {
          discounts: [{ promotion_code: match.id }],
          promoRejected: false,
        };
      }
    } catch {
      return { promoRejected: true };
    }
    return { promoRejected: true };
  }

  const launchOfferDiscount = await getLaunchOfferCheckoutDiscount({
    billingPeriod: args.billingPeriod,
  });
  if (launchOfferDiscount !== null) {
    return { discounts: [launchOfferDiscount], promoRejected: false };
  }
  return { promoRejected: false };
};
