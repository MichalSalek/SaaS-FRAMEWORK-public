// UI/features/checkout/hooks/useTrialClaim.ts
// Whether THIS checkout will start a free trial, known BEFORE the session is
// minted: the same kernel rule the backend applies when it mints the session
// (`canStartTrial`: trial never claimed AND payment status UNPAID/REJECTED).
// Used for what must be right before Stripe answers (the dialog title); the
// summary itself follows the session Stripe actually returned.

import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import { canStartTrial } from '@kernel/domain/pricing/pricing-policy';
import { useCurrentUserAccount } from '../../../../shared/hooks/useCurrentUserAccount';

export function useTrialClaim(planId: PricingPlan): boolean {
  const { data: user } = useCurrentUserAccount();
  return (
    planId !== PricingPlanValue.FREE &&
    canStartTrial({
      trialStartedAt: user?.stylist_account?.trial_started_at,
      paymentStatus: user?.stylist_account?.payment_status,
    })
  );
}
