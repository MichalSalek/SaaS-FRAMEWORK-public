import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import { isPlanDowngrade } from '@kernel/domain/pricing/pricing-policy';
import {
  planFeatureValue,
  resolvePlanFeatures,
  type PlanFeatureValue,
} from './plan-features.catalog';

function improves(previous: PlanFeatureValue, next: PlanFeatureValue): boolean {
  if (next.kind === 'absent') {
    return false;
  }
  if (previous.kind === 'absent') {
    return true;
  }
  if (next.kind === 'unlimited') {
    return previous.kind !== 'unlimited';
  }
  return (
    next.kind === 'limited' &&
    previous.kind === 'limited' &&
    next.count > previous.count
  );
}

/** Compare with the actual current tier, including upgrades that skip tiers. */
export function planFeatureGains(current: PricingPlan, target: PricingPlan) {
  if (!isPlanDowngrade(target, current)) {
    return [];
  }
  return resolvePlanFeatures(target)
    .filter(line =>
      improves(
        planFeatureValue(line.id, current),
        planFeatureValue(line.id, target)
      )
    )
    .slice(0, 2);
}
