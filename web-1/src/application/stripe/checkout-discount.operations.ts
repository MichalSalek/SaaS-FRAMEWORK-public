/**
 * One discount slot on a Checkout Session.
 *
 * DECISION: Stripe Checkout accepts a single discount, so precedence is explicit: (1) the QA
 * coupon (STRIPE_TEST_COUPON_ID) wins and the request promo is ignored; (2) a valid first-month
 * promotion code (EMAIL_OFFERS.FIRST_MONTH); (3) otherwise the launch offer, when its window is
 * open. An invalid or expired promo does NOT fall through to the launch offer: checkout still
 * succeeds at full price and the response sets promoRejected.
 */

import type Stripe from 'stripe';
import type { BillingCurrency } from '@kernel/domain/localization/country.config';
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

const couponSupportsCurrency = async (
  couponId: string,
  currency: BillingCurrency
): Promise<boolean> => {
  const coupon = await getStripe().coupons.retrieve(couponId, {
    expand: ['currency_options'],
  });
  if (!coupon.valid) {
    return false;
  }
  if (coupon.percent_off != null) {
    return true;
  }
  return (
    coupon.amount_off != null &&
    (coupon.currency === currency ||
      coupon.currency_options?.[currency]?.amount_off != null)
  );
};

export const resolveCheckoutDiscounts_IO = async (args: {
  billingPeriod: BillingPeriod;
  currency?: BillingCurrency;
  promo: string | undefined;
  stripeCustomerId: string;
  /** The session starts a free trial (canStartTrial). */
  trialEligible: boolean;
}): Promise<CheckoutDiscountDecision> => {
  const qaCouponId = ENV_VARS.STRIPE_TEST_COUPON_ID;
  if (qaCouponId) {
    try {
      if (await couponSupportsCurrency(qaCouponId, args.currency ?? 'pln')) {
        return { discounts: [{ coupon: qaCouponId }], promoRejected: false };
      }
    } catch {
      /* Checkout continues at full price. */
    }
    return { promoRejected: Boolean(args.promo) };
  }

  // DECISION: the first-month code is a `duration: once` coupon, so it is honoured ONLY for a
  // monthly plan without a trial. On a yearly price `once` discounts the WHOLE first year (20% of
  // an annual invoice instead of one month); with a trial the first invoice is the zero-amount
  // trial invoice, which would consume the single use. In both cases the session is minted at the
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
      const couponId = match ? couponIdOf(match) : null;
      if (
        match &&
        couponId &&
        (await couponSupportsCurrency(couponId, args.currency ?? 'pln'))
      ) {
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
  if (launchOfferDiscount?.promotion_code) {
    try {
      const promotion = await getStripe().promotionCodes.retrieve(
        launchOfferDiscount.promotion_code
      );
      const couponId = couponIdOf(promotion);
      if (
        couponId &&
        (await couponSupportsCurrency(couponId, args.currency ?? 'pln'))
      ) {
        return { discounts: [launchOfferDiscount], promoRejected: false };
      }
    } catch {
      /* Checkout continues at full price. */
    }
  }
  return { promoRejected: false };
};
