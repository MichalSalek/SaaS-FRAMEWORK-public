import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import type { PlanConfigType } from '@kernel/policies/pricing.policy';
import { PRICING_POLICY } from '@kernel/policies/pricing.policy';

/**
 * Get plan configuration (Centralized SSOT)
 *
 * NOTE: Previously this fetched from DB with 5m cache.
 * Now it uses the centralized PRICING_POLICY (SSOT) to ensure consistency.
 *
 * @param planId - Pricing plan identifier
 * @returns Plan configuration from shared-kernel policy
 */
export const getPlanConfig = async (
  planId: PricingPlan
): Promise<PlanConfigType> => {
  return PRICING_POLICY.utils.getPlanConfig(planId);
};
