import type Stripe from 'stripe';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';
import { isSupportedGrossPrice } from '@app/stripe/stripe-price-policy';

type TermsInput = {
  targetPrice: Stripe.Price;
  targetPriceId: string;
  currency: string;
  quantity: number;
  status: string;
  trialEnd: number | null;
  currentPeriodEnd: number;
  currentInterval: string | undefined;
  billingPeriod: BillingPeriod;
  invoice: Stripe.Invoice;
  cancelAt: string | null;
  now: number;
};

const futureIso = (value: unknown, now: number): string | null => {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value <= now
  ) {
    return null;
  }
  const date = new Date(value * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

/** Catalog amount is before discounts and customer balance, not a payment estimate. */
export const readPlanChangeTerms = (
  input: TermsInput
): {
  regularAmount: number;
  trialEndsAt: string | null;
  nextBillingAt: string | null;
} | null => {
  const { targetPrice, quantity } = input;
  if (
    targetPrice.id !== input.targetPriceId ||
    targetPrice.currency !== input.currency ||
    !isSupportedGrossPrice(targetPrice) ||
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    targetPrice.unit_amount == null
  ) {
    return null;
  }
  const regularAmount = targetPrice.unit_amount * quantity;
  if (!Number.isSafeInteger(regularAmount)) {
    return null;
  }

  const trialEndsAt =
    input.status === 'trialing' ? futureIso(input.trialEnd, input.now) : null;
  let nextBillingAt: string | null = null;
  if (input.status === 'trialing') {
    nextBillingAt = trialEndsAt;
  } else {
    const lines = input.invoice.lines?.data ?? [];
    const matching = lines.filter(
      line => line.pricing?.price_details?.price === input.targetPriceId
    );
    if (matching.length > 0) {
      const dates = matching.map(line =>
        futureIso(line.period?.end, input.now)
      );
      if (dates[0] != null && dates.every(date => date === dates[0])) {
        nextBillingAt = dates[0];
      }
    } else if (input.currentInterval === input.billingPeriod) {
      nextBillingAt = futureIso(input.currentPeriodEnd, input.now);
    }
  }
  if (
    nextBillingAt != null &&
    input.cancelAt != null &&
    input.cancelAt <= nextBillingAt
  ) {
    nextBillingAt = null;
  }
  return { regularAmount, trialEndsAt, nextBillingAt };
};
