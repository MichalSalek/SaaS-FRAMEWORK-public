// application/analytics/onboarding-events.ts
// Semantic events of the onboarding funnel (ANALYTICS_TRACKING_PLAN §3). They live in the
// application layer because TWO features emit them: auth/Onboarding (a client on preferences
// submit, a stylist on free_selected) and account/CheckoutReturn (a stylist after a CONFIRMED paid
// checkout; Stripe returns by redirect, so onboarding never sees that success). The posthog
// singleton = the PostHogProvider instance, which honours opt-out internally.

import { capturePosthog } from './posthog-client';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';

export type OnboardingCompletedRole = 'client' | 'stylist';

export function captureOnboardingCompleted(
  role: OnboardingCompletedRole,
  plan?: PricingPlan | null,
  billingPeriod?: BillingPeriod
): void {
  capturePosthog('onboarding_completed', {
    role,
    ...(plan != null ? { plan } : {}),
    ...(billingPeriod !== undefined ? { billing_period: billingPeriod } : {}),
  });
}
