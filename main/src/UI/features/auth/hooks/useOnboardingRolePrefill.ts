// UI/features/auth/hooks/useOnboardingRolePrefill.ts
// Pristine-field prefill for the onboarding form, strongest source first:
// explicit `?role=` → pricing funnel (plan, billing, stylist intent) → the
// account the user already owns. Every source writes ONLY untouched fields, so
// a choice the user made wins.
// Extracted from OnboardingPage.composition to keep it under the 300-line cap.

import { useEffect } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { usePricingFunnelState } from '../../../shared/hooks/usePricingFunnelState';
import { useCurrentUserAccount } from '../../../shared/hooks/useCurrentUserAccount';
import {
  applyAccountRoleHint,
  applyFunnelPrefill,
  roleHintFromAccounts,
} from '../onboarding.helpers';
import type { OnboardingFormValues, OnboardingRole } from '../onboarding.types';

export function useOnboardingRolePrefill(
  methods: UseFormReturn<OnboardingFormValues>,
  prefilledRole: OnboardingRole | null
): void {
  const { getPricingFunnel } = usePricingFunnelState();
  const { data: currentUser } = useCurrentUserAccount();
  const accountRoleHint = roleHintFromAccounts(currentUser);

  // DECISION: Next.js pages-router hydration race: `router.query` is empty on the first client
  // render and fills only after hydration (router.isReady). The page's useForm defaultValues are
  // computed once at mount, so they miss both `?role=` and the pricing-funnel deep link
  // (`?planId=&billingPeriod=`). Sync both into the form once the query resolves, but only while
  // the fields are still pristine, so a choice the user already made is never clobbered.
  useEffect(() => {
    if (prefilledRole && !methods.getFieldState('role').isDirty) {
      methods.setValue('role', prefilledRole);
    }
  }, [prefilledRole, methods]);

  useEffect(() => {
    // A funnel plan overrides the PRO default (ONBOARDING_DEFAULTS). Full semantics (plan/billing/
    // role-from-intent, dirty-wins) → applyFunnelPrefill in onboarding.helpers.
    applyFunnelPrefill(methods, getPricingFunnel(), prefilledRole);
  }, [getPricingFunnel, methods, prefilledRole]);

  // Without `?role=` and without a pricing funnel the role is hinted by the owned account, so a
  // client does not read the stylist welcome (semantics: roleHintFromAccounts).
  useEffect(() => {
    applyAccountRoleHint(
      methods,
      accountRoleHint,
      prefilledRole,
      getPricingFunnel() !== null
    );
  }, [accountRoleHint, getPricingFunnel, methods, prefilledRole]);
}
