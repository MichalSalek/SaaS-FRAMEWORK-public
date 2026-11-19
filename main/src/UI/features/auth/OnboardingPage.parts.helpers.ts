// UI/features/auth/OnboardingPage.parts.helpers.ts
// Non-React helpers extracted from OnboardingPage.composition (keeps the page
// under the 300-line cap): top-bar title, the plan field setters and the
// onboard request payloads. Type-only deps on next-intl / react-hook-form, so
// this stays a plain `.ts`.

import type { useTranslations } from 'next-intl';
import type { useForm } from 'react-hook-form';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';

import { publicNameFromAccount } from './onboarding.helpers';
import type { CompleteOnboardingVariables } from './hooks/useCompleteOnboarding';
import type { OnboardingFormValues } from './onboarding.types';

export type OnboardingT = ReturnType<
  typeof useTranslations<'pages.onboarding'>
>;

/** Top-bar title: the name of the process on the steps, „Gotowe" on the
 *  terminal success view. The step's own name is the indicator's line. */
export function onboardingNavTitle(
  showSuccess: boolean,
  t: OnboardingT
): string {
  return showSuccess ? t('navTitleSuccess') : t('processTitle');
}

/**
 * The three plan-field setters, one factory (split out of the composition).
 *
 * `shouldDirty` on EACH of them is a correctness condition, not cosmetics: the `applyFunnelPrefill`
 * effect overwrites only UNTOUCHED fields, so without marking a fresh choice dirty a re-run of the
 * effect restored the pricing-funnel plan on top of the user's decision (dirty-wins canon). This
 * applies equally to the Free hatch, the card choice and the billing cycle.
 *
 * The Free hatch keeps the choice IN THE FORM, not in separate state, because `selected_plan_id` is
 * a watched field that the composition passes straight to the payment panel: a second carrier of
 * the same decision would drift apart at once.
 */
export function makePlanFieldSetters(
  methods: ReturnType<typeof useForm<OnboardingFormValues>>
): {
  handleStartFree: () => void;
  handleSelectPlan: (plan: PricingPlan) => void;
  handleSelectBilling: (period: BillingPeriod) => void;
} {
  return {
    handleStartFree: () =>
      methods.setValue('selected_plan_id', PricingPlanValue.FREE, {
        shouldDirty: true,
      }),
    handleSelectPlan: plan =>
      methods.setValue('selected_plan_id', plan, { shouldDirty: true }),
    handleSelectBilling: period =>
      methods.setValue('billing_period', period, { shouldDirty: true }),
  };
}

/**
 * The stylist onboard request. Onboarding asks only for the role, so the
 * public name comes from the account (Google) when it has a usable one and the
 * city waits for the card after the first photo. `terms_accepted: true` is
 * true by construction: the request is sent by the button whose screen states
 * that continuing accepts the terms and confirms the age of 16 (DECISION in
 * onboarding.types.ts); the backend stamps User.terms_accepted_at once.
 * Marketing follows the visible checkbox; it must never be replaced with a hardcoded opt-out.
 */
export function stylistOnboardPayload(
  accountName: string | null | undefined,
  emailMarketing: boolean
): Extract<CompleteOnboardingVariables, { role: 'stylist' }> {
  return {
    role: 'stylist',
    display_name: publicNameFromAccount(accountName),
    address_city: null,
    phone: null,
    email_marketing: emailMarketing,
    instagram_handle: null,
    terms_accepted: true,
  };
}

/** The client onboard request (same terms acceptance by continuing). */
export function clientOnboardPayload(): Extract<
  CompleteOnboardingVariables,
  { role: 'client' }
> {
  return { role: 'client', terms_accepted: true };
}
