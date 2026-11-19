// UI/features/auth/onboarding.types.ts
// Shared form-value types for the OnboardingPage.
//
// DECISION: onboarding keeps one required decision, the role. A production stylist went
// through the welcome, the role and a block of consent checkboxes she toggled seven times, and left
// on the "Twoje dane" step before adding a single photo. So: the welcome is one sentence above the
// role cards; terms + the 16+ declaration are accepted by continuing, stated in a line under the
// cards (no checkbox; the request still sends `terms_accepted`, which stamps
// User.terms_accepted_at); name and city move to the card after her first photo (profile prompt in
// the gallery upload flow); optional marketing opt-in is also offered while creating the stylist
// account, and may be offered again after the first photo if still off. The Google account
// name seeds the public name at once; the notifications step is gone (the column defaults to ON,
// the switch lives in account settings). The plan + payment step stays only with an explicit plan
// intent (pricing card, plan link in an e-mail), free-first entry otherwise (DOMAIN_SSOT §18).
// (owner)

import {
  type PricingPlan,
  PricingPlanValue,
} from '@kernel/domain/pricing/pricing.config';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';

export type OnboardingRole = 'stylist' | 'client';

export interface OnboardingFormValues {
  /** The required role choice. */
  role: OnboardingRole | '';
  /** Optional stylist email opt-in. Existing preferences seed this value before the flow mounts. */
  email_marketing: boolean;
  /** CHECKOUT (stylist) — plan the user is paying for. The step exists only
   *  with an explicit pricing funnel, which overrides the PRO default at
   *  mount; without one the stylist starts on Free and never sees it, except
   *  as the fallback when Free activation fails. Consumed by the embedded
   *  checkout panel, never sent to the onboard endpoint. `null` still possible
   *  when a funnel carries an invalid/SCALE plan. */
  selected_plan_id: PricingPlan | null;
  /** CHECKOUT (stylist) — billing cycle for the chosen plan. */
  billing_period: BillingPeriod;
}

export const ONBOARDING_DEFAULTS: OnboardingFormValues = {
  role: '',
  email_marketing: false,
  // DECISION: the PRO preselection matters only where the chooser still renders: an explicit
  // pricing funnel overrides it at mount, and the one cold-start path to the chooser is the
  // fallback after a failed Free activation. Cold start itself goes straight to Free (free-first
  // entry, owner, DOMAIN_SSOT §18).
  selected_plan_id: PricingPlanValue.PRO,
  billing_period: 'month',
};

/* ─── Step model ─── */

/** Semantic step ids. */
export const ONBOARDING_STEP = Object.freeze({
  ROLE: 1,
  CHECKOUT: 2,
} as const);

/** Ordered step sequences per role — the SSOT for flow length + navigation.
 *  The stylist sequence drops CHECKOUT without an explicit plan intent. */
export const STEP_SEQUENCE_STYLIST: readonly number[] = [
  ONBOARDING_STEP.ROLE,
  ONBOARDING_STEP.CHECKOUT,
];
export const STEP_SEQUENCE_CLIENT: readonly number[] = [ONBOARDING_STEP.ROLE];
