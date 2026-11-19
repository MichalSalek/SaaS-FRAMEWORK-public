// UI/features/auth/onboarding.helpers.ts
// Pure helpers extracted from OnboardingPage (keeps the page under the 300-line
// cap). No React — plain functions over the onboarding form shape.

import type { UseFormReturn } from 'react-hook-form';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import { VALIDATION_LENGTHS } from '@kernel/policies/validation.config';
import type { SafeCurrentUserWire } from '@kernel/domain/user/user.contract-schemas';
import {
  ONBOARDING_STEP,
  STEP_SEQUENCE_CLIENT,
  STEP_SEQUENCE_STYLIST,
  type OnboardingFormValues,
  type OnboardingRole,
} from './onboarding.types';

export function isOnboardingRole(value: unknown): value is OnboardingRole {
  return value === 'stylist' || value === 'client';
}

/** Reads `?role=stylist|client` from the URL (intent passed from registration). */
export function readPrefilledRole(
  query: Record<string, string | string[] | undefined>
): OnboardingRole | null {
  const raw = Array.isArray(query.role) ? query.role[0] : query.role;
  return isOnboardingRole(raw) ? raw : null;
}

/**
 * Role implied by the accounts the user ALREADY has. Seeds the pristine role
 * field when nothing stronger arrived (`?role=` or a pricing funnel), so the
 * welcome step speaks to the right person before the role step is reached.
 *
 * DECISION: the signal is the OWNED account, not `account_type`. The column defaults to CLIENT, so
 * every fresh account after sign-up (both accounts null) "is a client" and the hint would switch
 * off the default stylist funnel. An existing StylistAccount wins over ClientAccount: such a person
 * reaches onboarding through the plan gate (useOnboardingPlanGuard, `plan-unresolved`), which sends
 * her only to plan selection, and a "client" hint would trap her in onboarding -> /app ->
 * onboarding. A ClientAccount alone = a client who came here by hand: she gets client copy, not
 * "Prowadzisz tu galerię swoich prac".
 */
export function roleHintFromAccounts(
  user:
    Pick<SafeCurrentUserWire, 'stylist_account' | 'client_account'> | undefined
): OnboardingRole | null {
  if (user === undefined) {
    return null;
  }
  if (user.stylist_account !== null) {
    return 'stylist';
  }
  if (user.client_account !== null) {
    return 'client';
  }
  return null;
}

/**
 * Account-derived role → pristine role field. Weakest source of the three:
 * an explicit `?role=` and a pricing funnel (stylist intent, applyFunnelPrefill)
 * both win, and so does anything the user already touched.
 */
export function applyAccountRoleHint(
  methods: UseFormReturn<OnboardingFormValues>,
  hint: OnboardingRole | null,
  prefilledRole: OnboardingRole | null,
  hasFunnel: boolean
): void {
  if (hint === null || prefilledRole !== null || hasFunnel) {
    return;
  }
  if (!methods.getFieldState('role').isDirty) {
    methods.setValue('role', hint);
  }
}

/**
 * The account name (Google gives one) → the public name the stylist account
 * starts with. Onboarding asks only for the role (owner), so a name
 * already on the account is used at once; one shorter than the public-name
 * minimum, or none (a magic-link signup), stays `null` and the card after the
 * first photo asks for it.
 */
export function publicNameFromAccount(
  accountName: string | null | undefined
): string | null {
  const name = (accountName ?? '')
    .trim()
    .slice(0, VALIDATION_LENGTHS.DISPLAY_NAME_MAX);
  return name.length < VALIDATION_LENGTHS.DISPLAY_NAME_MIN ? null : name;
}

/**
 * Whether the chosen role pays during onboarding. Stylists pick a plan + pay
 *(embedded checkout, the last step); clients never pick a paid plan — they have no
 * billing surface — so their flow ends one step earlier.
 *
 * DECISION: until a role is picked, assume the LONGER (stylist) flow so the stepper does not
 * visibly shrink the instant the user lands on the role step (collapsing the count mid-flow reads
 * as a glitch). The real branch resolves the moment a role card is selected.
 */
export function selectsPlan(role: OnboardingFormValues['role']): boolean {
  return role !== 'client';
}

/**
 * Free-first success may offer a paid plan and must say Free Demo.
 * A paid or trial completion, or a plan we cannot confirm, must not be
 * labeled Free. Clients never reach this (no billing surface).
 */
export function stylistSuccessOffersPaidPlan(
  planId: PricingPlan | null
): boolean {
  return planId === PricingPlanValue.FREE;
}

/**
 * The ordered step-id sequence for the active flow (SSOT for length + nav).
 *
 * DECISION: `withCheckout` = the stylist arrived with an EXPLICIT plan choice (a plan card on
 * /pricing or a plan link from an email). Only then does onboarding end on the plan + payment step.
 * Without it the stylist starts on Free straight after the role step and the trial is offered later
 * in the app (free-first entry, owner, DOMAIN_SSOT §18).
 */
export function stepSequenceForRole(
  role: OnboardingFormValues['role'],
  withCheckout = true
): readonly number[] {
  if (!selectsPlan(role)) {
    return STEP_SEQUENCE_CLIENT;
  }
  return withCheckout
    ? STEP_SEQUENCE_STYLIST
    : STEP_SEQUENCE_STYLIST.filter(step => step !== ONBOARDING_STEP.CHECKOUT);
}

/** Total steps for the active flow (role-dependent — derived from the sequence). */
export function totalStepsForRole(
  role: OnboardingFormValues['role'],
  withCheckout = true
): number {
  return stepSequenceForRole(role, withCheckout).length;
}

/**
 * 1-indexed DISPLAY position of a step within the active flow. Differs from the
 * step id for clients (who skip BASIC_INFO), so the stepper orb + hero pill show
 * a contiguous "N of M" while step ids stay semantic. Unknown step → 1.
 */
export function stepPositionForRole(
  step: number,
  role: OnboardingFormValues['role'],
  withCheckout = true
): number {
  const index = stepSequenceForRole(role, withCheckout).indexOf(step);
  return index < 0 ? 1 : index + 1;
}

/**
 * Funnel-intent → pristine form fields (split out of the composition under max-lines). The user's
 * dirty choice and an explicit `?role=` ALWAYS win; plan/billing overwrite only untouched fields
 * (canon of the funnel-sync effect). Role prefill: a plan funnel = a declaration of the STYLIST
 * path (do not lose the intent).
 */
export function applyFunnelPrefill(
  methods: UseFormReturn<OnboardingFormValues>,
  funnel: {
    planId: NonNullable<OnboardingFormValues['selected_plan_id']>;
    billingPeriod: OnboardingFormValues['billing_period'];
  } | null,
  prefilledRole: OnboardingRole | null
): void {
  if (funnel === null) {
    return;
  }
  if (!methods.getFieldState('selected_plan_id').isDirty) {
    methods.setValue('selected_plan_id', funnel.planId);
  }
  if (!methods.getFieldState('billing_period').isDirty) {
    methods.setValue('billing_period', funnel.billingPeriod);
  }
  if (prefilledRole === null && !methods.getFieldState('role').isDirty) {
    methods.setValue('role', 'stylist');
  }
}
