// UI/features/auth/hooks/useOnboardingFreeStart.ts
// Free-first stylist entry (owner 2026-09-23, DOMAIN_SSOT §18): the plan step
// exists only for a stylist who arrived with an explicit plan choice; everyone
// else is put on Free right after the account is created, and the 30-day Pro
// trial is offered later inside the app, at the moment of value.
// Extracted from OnboardingPage.composition to keep it under the 300-line cap.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useQueryClient } from '@tanstack/react-query';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { usePricingFunnelState } from '../../../shared/hooks/usePricingFunnelState';
import { usePlanCheckout } from '../../checkout/hooks/usePlanCheckout';

import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';

type FreeStartHandlers = {
  /** Show the plan + payment step (explicit intent, or Free fallback). */
  onCheckoutStep: () => void;
  onFreeActivated: (planId: PricingPlan, period: BillingPeriod) => void;
};

export function useOnboardingFreeStart({
  onCheckoutStep,
  onFreeActivated,
}: FreeStartHandlers): {
  /** true = the stylist flow ends on the plan + payment step. */
  withCheckout: boolean;
  isActivating: boolean;
  /** Account exists → plan step (explicit intent) or Free in place. */
  advanceStylist: () => void;
} {
  const { getPricingFunnel } = usePricingFunnelState();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { mutateAsync, isPending } = usePlanCheckout();
  const [withCheckout, setWithCheckout] = useState(false);
  // Same double-tap window as submitInFlightRef in the composition: isPending
  // flips a render late.
  const inFlightRef = useRef(false);

  // DECISION (nie usuwaj tego komentarza):
  // Latch, never unset. The funnel is read from the URL (`?planId=`, filled only
  // after hydration) or sessionStorage, so the first render cannot see it; once
  // an explicit plan intent is seen, the flow keeps its plan step even if the
  // query changes later. A stylist with NO intent never sees a plan chooser
  // unless the Free activation below fails (then the chooser is the fallback,
  // because a stylist without a resolved plan is bounced back to onboarding by
  // useOnboardingPlanGuard).
  useEffect(() => {
    if (getPricingFunnel() !== null) {
      setWithCheckout(true);
    }
  }, [getPricingFunnel]);

  const advanceStylist = (): void => {
    // The latch is set in an effect, so re-read the intent at decision time: a
    // draft restored to PREFERENCES can meet a `?planId=` query one paint before
    // the effect runs, and Free is irreversible (plan_selected_at). An unready
    // router cannot rule the query out yet, so it takes the chooser too
    // (Grok review 2026-09-23).
    if (withCheckout || !router.isReady || getPricingFunnel() !== null) {
      setWithCheckout(true);
      onCheckoutStep();
      return;
    }
    if (inFlightRef.current) {
      return;
    }
    inFlightRef.current = true;
    const fallBack = (): void => {
      inFlightRef.current = false;
      setWithCheckout(true);
      onCheckoutStep();
    };
    // DECISION (nie usuwaj tego komentarza):
    // mutateAsync, not mutate(vars, callbacks). TanStack Query v5 drops per-call
    // callbacks when the observer unmounts (see PlanCheckoutPanel), while the
    // request itself still commits Free. The drawer stays usable during the
    // call, so a stylist can leave mid-flight; the promise chain still refreshes
    // the account, otherwise useOnboardingPlanGuard reads the stale
    // `plan_selected_at: null` and sends her back to onboarding.
    mutateAsync({
      planId: PricingPlanValue.FREE,
      billingPeriod: 'month',
      source: 'onboarding',
    })
      .then(response => {
        if (response.mode !== 'free_selected') {
          fallBack();
          return;
        }
        inFlightRef.current = false;
        void queryClient.invalidateQueries({
          queryKey: queryKeys.account.current,
        });
        // Plan limits changed → usage-vs-limit stats must re-derive.
        void queryClient.invalidateQueries({
          queryKey: queryKeys.account.usageStats,
        });
        onFreeActivated(PricingPlanValue.FREE, 'month');
      })
      // The hook-level onError already toasts (usePlanCheckout).
      .catch(fallBack);
  };

  return { withCheckout, isActivating: isPending, advanceStylist };
}
