import { PLAN_TIER_ORDER } from './pricing-policy';
import { PricingPlanValue, type PricingPlan } from './pricing.config';

export type SalonPlan = {
  salon_account_id: string;
  salon_name: string;
  pricing_plan: PricingPlan;
};
export type EffectivePlanFields = {
  effective_pricing_plan?: PricingPlan;
  salon_plan?: SalonPlan | null;
};

// The session wire's zod `.optional()` output includes `undefined`. A row
// omits the field. The reader accepts both; the stored shape stays optional.
type EffectivePlanRead = {
  pricing_plan: PricingPlan;
  effective_pricing_plan?: PricingPlan | undefined;
  salon_plan?: SalonPlan | null | undefined;
};

export function getEffectivePricingPlan(
  account: EffectivePlanRead | null | undefined
): PricingPlan {
  return (
    account?.effective_pricing_plan ??
    account?.pricing_plan ??
    PricingPlanValue.FREE
  );
}

export function resolveEffectivePlan(
  ownPlan: PricingPlan,
  memberships: readonly {
    accepted_at: Date | string | null;
    is_active: boolean;
    owner_plan: PricingPlan;
    owner_subscription_status: string | null;
    salon_account_id: string;
    salon_name: string;
  }[]
): { effective_pricing_plan: PricingPlan; salon_plan: SalonPlan | null } {
  let effective_pricing_plan = ownPlan;
  let salon_plan: SalonPlan | null = null;
  for (const membership of memberships) {
    if (
      !membership.is_active ||
      membership.accepted_at === null ||
      membership.owner_subscription_status !== 'ACTIVE' ||
      ![PricingPlanValue.STUDIO, PricingPlanValue.SCALE].some(
        plan => plan === membership.owner_plan
      )
    ) {
      continue;
    }
    if (
      salon_plan === null ||
      PLAN_TIER_ORDER.indexOf(membership.owner_plan) >
        PLAN_TIER_ORDER.indexOf(salon_plan.pricing_plan)
    ) {
      salon_plan = {
        salon_account_id: membership.salon_account_id,
        salon_name: membership.salon_name,
        pricing_plan: membership.owner_plan,
      };
    }
    if (
      PLAN_TIER_ORDER.indexOf(membership.owner_plan) >
      PLAN_TIER_ORDER.indexOf(effective_pricing_plan)
    ) {
      effective_pricing_plan = membership.owner_plan;
    }
  }
  return { effective_pricing_plan, salon_plan };
}
