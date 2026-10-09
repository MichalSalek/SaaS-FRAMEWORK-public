// UI/features/auth/onboarding.types.ts
// Shared form-value types for the multi-step OnboardingPage.
//
// DECISION (nie usuwaj tego komentarza):
// Fields kept lean — only those wired to backend at onboarding time:
//  - role, terms_accepted                 (legal/identity gate, Step 2 — terms
//    now also carries the age-16 declaration, merged into one consent row)
//  - marketing_consent                    (Step 2 — stylist-only optional opt-in;
//    persisted as StylistAccount.email_marketing in ONBOARD_AS_STYLIST)
//  - display_name, address_city, phone   (Step 3 — sent in ONBOARD_AS_STYLIST)
//  - notifications_on                     (Step 4 — synced via notification prefs)
//  - selected_plan_id, billing_period    (Step 5 — stylist-only plan choice,
//    seeded from the pricing funnel (W3). NOT sent to the onboard endpoint —
//    consumed by the embedded PlanCheckoutPanel (W2), which mints its own
//    Checkout Session. Carried in the form so Back/Continue keeps the choice.)
// Previously held: salon_name, specialization, preferred_styles, profile_public.
// All four were SILENTLY DROPPED — captured client-side, never sent to backend,
// no matching schema columns (StylistAccount has no salon_name/specialization/
// preferred_styles/is_public). Wave F audit removed them rather than wire fake
// fields; users can fill richer profile data in Settings post-onboarding once
// those features ship. Anti-pattern fixed: collecting data we throw away.

import {
  type PricingPlan,
  PricingPlanValue,
} from '@kernel/domain/pricing/pricing.config';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';

export type OnboardingRole = 'stylist' | 'client';

export interface OnboardingFormValues {
  /** Step 2 — required. */
  role: OnboardingRole | '';
  /** Step 3 — sent to backend (StylistAccount.display_name). */
  display_name: string;
  /** Step 3 — sent to backend (StylistAccount.address_city). */
  address_city: string;
  /** Step 3 — stylist only, optional, sent as StylistAccount.phone. */
  phone: string;
  /** Step 3 — stylist only, optional. Raw input („@name” or a pasted profile
   *  URL are fine); normalized by normalizeInstagramHandle before sending.
   *  Base of the auto-assigned public profile address (owner 2026-09-23). */
  instagram_handle: string;
  /** Step 2 — RODO Art. 6(1)(a): explicit ToS + privacy acceptance. Also
   *  carries the RODO Art. 8 age-16 declaration (merged into one consent row). */
  terms_accepted: boolean;
  /** Step 2 — stylist-only optional marketing opt-in. Persisted as
   *  StylistAccount.email_marketing. Default OFF (RODO: opt-in, never pre-ticked). */
  marketing_consent: boolean;
  /** Step 4 — N2 default ON. Synced to backend after onboarding completes. */
  notifications_on: boolean;
  /** Step 5 (stylist) — plan the user is paying for. The step exists only with
   *  an explicit pricing funnel (W3), which overrides the PRO default at mount;
   *  without one the stylist starts on Free and never sees it (free-first entry,
   *  owner 2026-09-23 §18), except as the fallback when Free activation fails.
   *  Consumed by the embedded checkout panel (W2), never sent to the onboard
   *  endpoint. `null` still possible when a funnel carries an invalid/SCALE plan. */
  selected_plan_id: PricingPlan | null;
  /** Step 5 (stylist) — billing cycle for the chosen plan. */
  billing_period: BillingPeriod;
}

export const ONBOARDING_DEFAULTS: OnboardingFormValues = {
  role: '',
  display_name: '',
  address_city: '',
  phone: '',
  instagram_handle: '',
  terms_accepted: false,
  marketing_consent: false,
  notifications_on: true,
  // DECISION (nie usuwaj tego komentarza):
  // PRO preselection only matters where the chooser still renders: an explicit
  // pricing funnel overrides it at mount, and the one cold-start path to the
  // chooser is the fallback after a failed Free activation. Cold start itself
  // goes straight to Free (free-first entry, owner 2026-09-23, DOMAIN_SSOT §18;
  // reverses the 2026-07-14 trial-forward entry).
  selected_plan_id: PricingPlanValue.PRO,
  billing_period: 'month',
};

/* ─── Step model ─── */

// DECISION (nie usuwaj tego komentarza):
// The flow is ROLE-DEPENDENT and driven by a per-role STEP SEQUENCE (SSOT below),
// NOT by contiguous ±1 stepping. Stylists run 5 steps (last = plan + embedded
// payment); clients run 3: welcome → role → preferences. Clients SKIP BASIC_INFO
// entirely — display_name/address_city have no ClientAccount columns and were
// silently dropped (the same anti-pattern Wave F removed for salon_name/etc.), so
// we do not collect them (owner decision 2026-07-03; a client's name already
// exists from registration via better-auth user.name). The stepper, hero counter
// and per-step copy all read the sequence via stepSequenceForRole / stepPosition,
// so a single source drives both flows and step IDs stay semantic (position ≠ id
// for clients). Success is a TERMINAL view (not a step in the counter).

/** Semantic step ids (NOT display positions — clients skip BASIC_INFO). */
export const ONBOARDING_STEP = Object.freeze({
  WELCOME: 1,
  ROLE: 2,
  BASIC_INFO: 3,
  PREFERENCES: 4,
  CHECKOUT: 5,
} as const);

/** Ordered step sequences per role — the SSOT for flow length + navigation. */
export const STEP_SEQUENCE_STYLIST: readonly number[] = [
  ONBOARDING_STEP.WELCOME,
  ONBOARDING_STEP.ROLE,
  ONBOARDING_STEP.BASIC_INFO,
  ONBOARDING_STEP.PREFERENCES,
  ONBOARDING_STEP.CHECKOUT,
];
export const STEP_SEQUENCE_CLIENT: readonly number[] = [
  ONBOARDING_STEP.WELCOME,
  ONBOARDING_STEP.ROLE,
  ONBOARDING_STEP.PREFERENCES,
];

/** Stylists: 5 steps (welcome → role → dane → preferencje → checkout). */
export const TOTAL_ONBOARDING_STEPS_STYLIST = STEP_SEQUENCE_STYLIST.length;
/** Clients: 3 steps (welcome → role → preferencje); no basic-info, no checkout. */
export const TOTAL_ONBOARDING_STEPS_CLIENT = STEP_SEQUENCE_CLIENT.length;
