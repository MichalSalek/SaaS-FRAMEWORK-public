// UI/features/checkout/hooks/useCheckoutPlanHighlights.ts
// The few capabilities named on the last step before payment: a projection of
// the plan feature catalog (`application/pricing/plan-features.catalog.ts`),
// the same source as the plan cards and the success screen. Each plan leads
// with what ONLY it brings over the next cheaper plan, because four lines is
// all this step has.

import { useTranslations } from 'next-intl';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import {
  PLAN_FEATURE_NAMESPACE,
  planFeatureHighlights,
} from '../../../../application/pricing/plan-features.catalog';
import { planFeatureGains } from '../../../../application/pricing/plan-feature-gains';

const MAX_HIGHLIGHTS = 4;

export function useCheckoutPlanHighlights(
  planId: PricingPlan,
  currentPlan?: PricingPlan
): string[] {
  const t = useTranslations(PLAN_FEATURE_NAMESPACE);
  // FREE never reaches the payment step; SCALE is sold by contact.
  if (planId === PricingPlanValue.FREE || planId === PricingPlanValue.SCALE) {
    return [];
  }
  const lines =
    currentPlan === undefined
      ? planFeatureHighlights(planId, MAX_HIGHLIGHTS)
      : planFeatureGains(currentPlan, planId);
  return lines.map(line => t(line.key, line.params));
}
