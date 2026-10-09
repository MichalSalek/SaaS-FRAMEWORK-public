// UI/features/auth/hooks/useOnboardingRolePrefill.ts
// Pristine-field prefill for the onboarding form, strongest source first:
// explicit `?role=` → pricing funnel (plan, billing, stylist intent) → the
// account the user already owns. Every source writes ONLY untouched fields, so
// a choice the user made (and a restored draft, see useOnboardingDraft) wins.
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

  // DECISION (nie usuwaj tego komentarza):
  // Next.js pages-router hydration race: `router.query` is empty on the first
  // client render and only fills in after hydration (router.isReady). The
  // page's useForm defaultValues are computed once at mount, so they miss both
  // `?role=` AND the pricing-funnel deep-link (`?planId=&billingPeriod=`). Sync
  // both into the form once the query resolves, but only while the fields are
  // still pristine so we never clobber a choice the user already made.
  useEffect(() => {
    if (prefilledRole && !methods.getFieldState('role').isDirty) {
      methods.setValue('role', prefilledRole);
    }
  }, [prefilledRole, methods]);

  useEffect(() => {
    // A funnel plan overrides the PRO default (ONBOARDING_DEFAULTS). Pełna semantyka (plan/billing/rola-z-intencji,
    // dirty-wins) → applyFunnelPrefill w onboarding.helpers (S76).
    applyFunnelPrefill(methods, getPricingFunnel(), prefilledRole);
  }, [getPricingFunnel, methods, prefilledRole]);

  // S122: bez `?role=` i bez lejka cennika rolę podpowiada posiadane konto, więc
  // klientka nie czyta powitania stylistki (semantyka: roleHintFromAccounts).
  useEffect(() => {
    applyAccountRoleHint(
      methods,
      accountRoleHint,
      prefilledRole,
      getPricingFunnel() !== null
    );
  }, [accountRoleHint, getPricingFunnel, methods, prefilledRole]);
}
