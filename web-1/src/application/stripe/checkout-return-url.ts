// application/stripe/checkout-return-url.ts
//
// DECISION: ONE builder of the return address for BOTH checkout variants (embedded `return_url`
// and hosted `success_url`). The return page verifies the owned CheckoutAttempt session with
// Stripe and the entitlement already written by the backend; a matching plan name alone is
// insufficient. Plan/period/source travel next to Stripe's literal `{CHECKOUT_SESSION_ID}`
// placeholder (Stripe replaces it and keeps the rest of the query) as navigation and analytics
// context. Query parameters grant no entitlement.

import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';
import type {
  BillingCurrency,
  CountryCode,
} from '@kernel/domain/localization/country.config';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import { ENV_VARS } from '@app/environment/environment.config';

export const CHECKOUT_SESSION_ID_PLACEHOLDER = '{CHECKOUT_SESSION_ID}';

export function buildCheckoutReturnUrl({
  planId,
  billingPeriod,
  source,
  currency,
  billingCountry,
}: {
  planId: PricingPlan;
  billingPeriod: BillingPeriod;
  source?: string | undefined;
  currency?: BillingCurrency | undefined;
  billingCountry?: CountryCode | undefined;
}): string {
  const query = new URLSearchParams({
    plan: planId,
    period: billingPeriod,
    ...(currency && { currency }),
    ...(billingCountry && { billingCountry }),
    ...(source !== undefined && { source }),
  }).toString();
  return `${ENV_VARS.PUBLIC_URL}/app/checkout/return?sessionId=${CHECKOUT_SESSION_ID_PLACEHOLDER}&${query}`;
}
