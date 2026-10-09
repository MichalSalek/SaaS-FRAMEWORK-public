// application/stripe/checkout-return-url.ts
//
// DECISION (nie usuwaj tego komentarza):
// JEDEN builder adresu powrotu dla OBU wariantów checkoutu (embedded `return_url`
// i hosted `success_url`). Strona powrotu (/app/checkout/return) nie ma endpointu
// statusu sesji (webhook = jedyna prawda), więc „płatność potwierdzona" rozstrzyga
// po tym, czy webhook zapisał DOKŁADNIE ten plan — parametry plan/period/source
// jadą obok placeholdera Stripe `{CHECKOUT_SESSION_ID}` (literalny, Stripe
// podstawia go string-replace'em i zachowuje resztę query). Hosted wracał wcześniej
// prosto na `/app?checkout=done`, omijając polling webhooka (bounce do onboardingu
// przy wolnym webhooku) i event analityczny końca onboardingu.
// Parametry służą wyłącznie do porównania z prawdą serwera i do analityki; ich
// podmiana w URL niczego nie nadaje.

import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import { ENV_VARS } from '@app/environment/environment.config';

export const CHECKOUT_SESSION_ID_PLACEHOLDER = '{CHECKOUT_SESSION_ID}';

export function buildCheckoutReturnUrl({
  planId,
  billingPeriod,
  source,
}: {
  planId: PricingPlan;
  billingPeriod: BillingPeriod;
  source?: string | undefined;
}): string {
  const query = new URLSearchParams({
    plan: planId,
    period: billingPeriod,
    ...(source !== undefined && { source }),
  }).toString();
  return `${ENV_VARS.PUBLIC_URL}/app/checkout/return?sessionId=${CHECKOUT_SESSION_ID_PLACEHOLDER}&${query}`;
}
