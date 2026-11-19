import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';

/**
 * SSOT for per-plan conversion-funnel hrefs: the main pricing page (/pricing) AND the
 * LP mini-pricings (for-stylists, for-studios) enter EXACTLY the same funnel, so the
 * href logic lives in one place (reuse without fully unifying the plan cards).
 *
 * DECISION: pricing CTAs target an ACCOUNT route (payment), so the funnel enters web login →
 * /pay on EVERY viewport, desktop included, with no /get-app bounce (that bounce is for product
 * routes only). route-access.policy allows account routes (web-login-first).
 */

/**
 * Deep-link login -> pay: after login it lands straight on /pay (not the generic
 * dashboard). planId + billingPeriod survive the redirect in sessionStorage
 * (`usePricingFunnelState`, set onClick): a query on the login URL is lost on the
 * 302 to `from`, so sessionStorage is the channel that carries them to /pay.
 */
export const buildPlanLoginHref = (
  planId: PricingPlan,
  billingPeriod: BillingPeriod
): string =>
  `${ROUTES_FRONT.USER_LOG}?from=${encodeURIComponent(
    ROUTES_FRONT.USER_ACCOUNT_PAY
  )}&planId=${planId}&billingPeriod=${billingPeriod}`;

/**
 * Deep link straight to /pay (logged-in stylist) carrying the chosen plan + period.
 * Without these params /pay lost the funnel intent and forced a SECOND plan choice;
 * it now reads them (`usePricingFunnelState`, precedence query > storage).
 */
export const buildPlanPayDeepLink = (
  planId: PricingPlan,
  billingPeriod: BillingPeriod
): string =>
  `${ROUTES_FRONT.USER_ACCOUNT_PAY}?planId=${planId}&billingPeriod=${billingPeriod}`;
