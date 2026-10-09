import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';

/**
 * SSOT dla per-plan conversion-funnel hrefów — główny cennik (/pricing) I
 * mini-cenniki na LP (for-stylists, for-studios) wpinają w DOKŁADNIE ten sam
 * funnel, więc logika href-a żyje w jednym miejscu (reużywalność bez pełnej
 * unifikacji kart planów — ta jest osobną sesją, głos ownera 2026-07-03).
 *
 * DECISION (nie usuwaj tego komentarza):
 * Pricing CTA to ACCOUNT-route (płatność), więc funnel wchodzi w web-login →
 * /pay na KAŻDYM viewporcie, desktop włącznie — bez /get-app bounce (bounce
 * dotyczy tylko PRODUCT-route: produkt mobilny, nie płatności).
 * Zgodne z web-login-first (route-access.policy zwalnia account-routes).
 */

/**
 * Deep-link login→pay: po zalogowaniu ląduje wprost na /pay (nie generic
 * dashboard). planId + billingPeriod przetrwają redirect w sessionStorage
 * (`usePricingFunnelState` ustawiane onClick) — query na URL logowania gubi się
 * przy 302 na `from`, więc sessionStorage jest kanałem, który je donosi na /pay.
 */
export const buildPlanLoginHref = (
  planId: PricingPlan,
  billingPeriod: BillingPeriod
): string =>
  `${ROUTES_FRONT.USER_LOG}?from=${encodeURIComponent(
    ROUTES_FRONT.USER_ACCOUNT_PAY
  )}&planId=${planId}&billingPeriod=${billingPeriod}`;

/**
 * Deep-link wprost na /pay (zalogowana stylistka) niosący wybrany plan + okres.
 * Bez tych paramów /pay gubił funnel-intent i wymuszał DRUGI wybór planu —
 * czyta je teraz (`usePricingFunnelState`, precedencja query > storage).
 */
export const buildPlanPayDeepLink = (
  planId: PricingPlan,
  billingPeriod: BillingPeriod
): string =>
  `${ROUTES_FRONT.USER_ACCOUNT_PAY}?planId=${planId}&billingPeriod=${billingPeriod}`;
