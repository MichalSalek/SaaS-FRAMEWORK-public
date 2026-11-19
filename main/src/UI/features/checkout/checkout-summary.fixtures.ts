// Stripe Checkout Session payloads (custom UI mode) as the browser SDK hands
// them over, cut to what the summary reads. Example figures, not the price
// list: prices live in Stripe.

import type { CheckoutSummarySource } from './checkout-summary.helpers';

/** Stripe separates an amount from its currency with a no-break space. */
const NBSP = String.fromCharCode(160);

const zl = (minor: number) => ({
  minorUnitsAmount: minor,
  amount: `${(minor / 100).toFixed(2).replace('.', ',')}${NBSP}zł`,
});

const charge = (net: number, discount: number, vat: number) => ({
  subtotal: zl(net),
  discount: zl(discount),
  taxExclusive: zl(vat),
  taxInclusive: zl(0),
  total: zl(net - discount + vat),
});

const chargeInclusive = (gross: number, discount: number, vat: number) => ({
  subtotal: zl(gross),
  discount: zl(discount),
  taxExclusive: zl(0),
  taxInclusive: zl(vat),
  total: zl(gross - discount),
});

/** 10 November 2026, noon UTC: the trial end Stripe reports (unix seconds). */
export const TRIAL_END_UNIX = Date.UTC(2026, 10, 10, 12) / 1000;

const trial = { trialEnd: TRIAL_END_UNIX, trialPeriodDays: 30 };

export const SESSION_TRIAL_PRO_MONTHLY: CheckoutSummarySource = {
  // What the old summary mixed: today's subtotal is the plan's net, while
  // today's tax and total are zero.
  total: {
    subtotal: zl(6000),
    discount: zl(0),
    taxExclusive: zl(0),
    taxInclusive: zl(0),
    total: zl(0),
  },
  recurring: { interval: 'month', dueNext: charge(6000, 0, 1380), trial },
  discountAmounts: null,
};

export const SESSION_TRIAL_STUDIO_MONTHLY: CheckoutSummarySource = {
  total: {
    subtotal: zl(17900),
    discount: zl(0),
    taxExclusive: zl(0),
    taxInclusive: zl(0),
    total: zl(0),
  },
  recurring: { interval: 'month', dueNext: charge(17900, 0, 4117), trial },
  discountAmounts: null,
};

export const SESSION_TRIAL_PRO_YEARLY: CheckoutSummarySource = {
  total: {
    subtotal: zl(60000),
    discount: zl(0),
    taxExclusive: zl(0),
    taxInclusive: zl(0),
    total: zl(0),
  },
  recurring: { interval: 'year', dueNext: charge(60000, 0, 13800), trial },
  discountAmounts: null,
};

export const SESSION_NO_TRIAL_PRO_MONTHLY: CheckoutSummarySource = {
  total: charge(6000, 0, 1380),
  recurring: { interval: 'month', dueNext: charge(6000, 0, 1380), trial: null },
  discountAmounts: null,
};

/** First-month code (20%, duration once) on a monthly plan without a trial. */
export const SESSION_PROMO_PRO_MONTHLY: CheckoutSummarySource = {
  total: charge(6000, 1200, 1104),
  recurring: { interval: 'month', dueNext: charge(6000, 0, 1380), trial: null },
  discountAmounts: [{ displayName: 'Pierwszy miesiąc 20%', recurring: null }],
};

/** A trial whose recurring charge Stripe did not state. */
export const SESSION_TRIAL_AMOUNT_UNAVAILABLE: CheckoutSummarySource = {
  total: {
    subtotal: zl(17900),
    discount: zl(0),
    taxExclusive: zl(0),
    taxInclusive: zl(0),
    total: zl(0),
  },
  recurring: {
    interval: 'month',
    dueNext: {
      subtotal: zl(17900),
      discount: zl(0),
      taxExclusive: zl(0),
      taxInclusive: zl(0),
      total: zl(0),
    },
    trial,
  },
  discountAmounts: null,
};

// DECISION: These captured inclusive-tax amounts verify that the summary uses
// Stripe's gross totals and reports included VAT without adding it again.
export const SESSION_GROSS_STUDIO_MONTHLY: CheckoutSummarySource = {
  total: chargeInclusive(17900, 0, 3347),
  recurring: {
    interval: 'month',
    dueNext: chargeInclusive(17900, 0, 3347),
    trial: null,
  },
  discountAmounts: null,
};

export const SESSION_GROSS_STUDIO_YEARLY: CheckoutSummarySource = {
  total: chargeInclusive(171600, 0, 32088),
  recurring: {
    interval: 'year',
    dueNext: chargeInclusive(171600, 0, 32088),
    trial: null,
  },
  discountAmounts: null,
};

export const SESSION_GROSS_TRIAL_STUDIO_MONTHLY: CheckoutSummarySource = {
  total: {
    subtotal: zl(0),
    discount: zl(0),
    taxExclusive: zl(0),
    taxInclusive: zl(0),
    total: zl(0),
  },
  recurring: {
    interval: 'month',
    dueNext: chargeInclusive(17900, 0, 3347),
    trial,
  },
  discountAmounts: null,
};

export const SESSION_GROSS_PROMO_STUDIO_MONTHLY: CheckoutSummarySource = {
  total: chargeInclusive(17900, 3580, 2678),
  recurring: {
    interval: 'month',
    dueNext: chargeInclusive(17900, 0, 3347),
    trial: null,
  },
  discountAmounts: [{ displayName: 'Pierwszy miesiąc 20%', recurring: null }],
};

export const SESSION_GROSS_FULL_DISCOUNT_STUDIO_MONTHLY: CheckoutSummarySource =
  {
    total: chargeInclusive(17900, 17900, 0),
    recurring: {
      interval: 'month',
      dueNext: chargeInclusive(17900, 0, 3347),
      trial: null,
    },
    discountAmounts: [
      { displayName: 'QA 100%', recurring: { type: 'forever' } },
    ],
  };

export const SESSION_GROSS_INCONSISTENT_TAX: CheckoutSummarySource = {
  ...SESSION_GROSS_STUDIO_MONTHLY,
  total: {
    ...chargeInclusive(17900, 0, 3347),
    taxExclusive: zl(100),
  },
};
