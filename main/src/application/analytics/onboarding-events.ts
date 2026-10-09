// application/analytics/onboarding-events.ts
// Semantyczne eventy funnela onboardingu (ANALYTICS_TRACKING_PLAN §3). Żyją w
// warstwie application, bo emitują je DWA feature'y: auth/Onboarding (klientka na
// submicie preferencji, stylistka na free_selected) oraz account/CheckoutReturn
// (stylistka po POTWIERDZONYM płatnym checkoucie — Stripe wraca redirectem, więc
// onboarding nigdy nie widzi tego sukcesu). posthog singleton = instancja
// PostHogProvider, respektuje opt-out wewnętrznie.

import posthog from 'posthog-js';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';

export type OnboardingCompletedRole = 'client' | 'stylist';

export function captureOnboardingCompleted(
  role: OnboardingCompletedRole,
  plan?: PricingPlan | null,
  billingPeriod?: BillingPeriod
): void {
  posthog.capture('onboarding_completed', {
    role,
    ...(plan != null ? { plan } : {}),
    ...(billingPeriod !== undefined ? { billing_period: billingPeriod } : {}),
  });
}
