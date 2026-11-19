import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
const PAID: ReadonlySet<string> = new Set([
  PricingPlanValue.PRO,
  PricingPlanValue.PRO_PLUS,
  PricingPlanValue.STUDIO,
]);

export type CancelAnchor = {
  canceledAt: Date;
  oldPlan: PricingPlan;
};

export const readCancelAnchor = (
  payload: unknown,
  createdAt: Date
): CancelAnchor | null => {
  if (payload == null || typeof payload !== 'object') {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const oldPlan = record['oldPricingPlan'];
  if (
    record['newPricingPlan'] !== PricingPlanValue.FREE ||
    record['source'] !== 'stripe' ||
    typeof oldPlan !== 'string' ||
    !PAID.has(oldPlan)
  ) {
    return null;
  }
  return { canceledAt: createdAt, oldPlan: oldPlan as PricingPlan };
};
