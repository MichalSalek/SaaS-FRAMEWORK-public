// UI/features/auth/hooks/useOnboardingFreeStart.ts
// Free-first stylist entry (owner, DOMAIN_SSOT §18): the plan step
// exists only for a stylist who arrived with an explicit plan choice; everyone
// else is put on Free right after the account is created, and the Pro
// trial is offered later inside the app, at the moment of value.
// Extracted from OnboardingPage.composition to keep it under the 300-line cap.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useQueryClient } from '@tanstack/react-query';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { usePricingFunnelState } from '../../../shared/hooks/usePricingFunnelState';
import { usePlanCheckout } from '../../shared/checkout/hooks/usePlanCheckout';

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

  // DECISION: latch, never unset. The funnel is read from the URL (`?planId=`, filled only after
  // hydration) or sessionStorage, so the first render cannot see it; once an explicit plan intent
  // is seen, the flow keeps its plan step even if the query changes later. A stylist with NO intent
  // never sees a plan chooser unless the Free activation below fails (then the chooser is the
  // fallback, because a stylist without a resolved plan is bounced back to onboarding by
  // useOnboardingPlanGuard).
  useEffect(() => {
    if (getPricingFunnel() !== null) {
      setWithCheckout(true);
    }
  }, [getPricingFunnel]);

  const advanceStylist = (): void => {
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
