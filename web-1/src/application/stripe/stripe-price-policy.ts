import type Stripe from 'stripe';

/** A self-serve catalog price must be a fixed, positive gross amount. */
export const isSupportedGrossPrice = (price: Stripe.Price): boolean =>
  price.billing_scheme === 'per_unit' &&
  price.tax_behavior === 'inclusive' &&
  price.unit_amount !== null &&
  Number.isSafeInteger(price.unit_amount) &&
  price.unit_amount > 0;
