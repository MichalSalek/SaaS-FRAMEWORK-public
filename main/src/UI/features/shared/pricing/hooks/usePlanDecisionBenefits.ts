import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import { useCheckoutPlanHighlights } from '../../../checkout/hooks/useCheckoutPlanHighlights';

export function usePlanDecisionBenefits(
  current: PricingPlan,
  target: PricingPlan
): string[] {
  return useCheckoutPlanHighlights(target, current);
}
