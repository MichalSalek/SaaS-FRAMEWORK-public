import { PRICING_POLICY } from '@kernel/policies/pricing.policy';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';

/** Own configured salon survives plan expiry; inherited team access never creates ownership. */
export function hasOwnSalon(
  account:
    | {
        pricing_plan: PricingPlan;
        has_salon_profile?: boolean | undefined;
      }
    | null
    | undefined
): boolean {
  return Boolean(
    account &&
    (account.has_salon_profile ||
      PRICING_POLICY.LIMITS[account.pricing_plan].can_have_salon_profile)
  );
}
