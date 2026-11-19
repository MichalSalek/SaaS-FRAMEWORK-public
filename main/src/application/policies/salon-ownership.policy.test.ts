import { describe, expect, it } from 'vitest';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { hasOwnSalon } from './salon-ownership.policy';

describe('durable salon ownership', () => {
  it('keeps a configured salon reachable after a downgrade', () => {
    expect(
      hasOwnSalon({
        pricing_plan: PricingPlanValue.FREE,
        has_salon_profile: true,
      })
    ).toBe(true);
    expect(
      hasOwnSalon({
        pricing_plan: PricingPlanValue.PRO,
        has_salon_profile: true,
      })
    ).toBe(true);
  });
  it('does not infer ownership from a member’s inherited benefits', () => {
    expect(hasOwnSalon({ pricing_plan: PricingPlanValue.FREE })).toBe(false);
    expect(hasOwnSalon(undefined)).toBe(false);
  });
  it('allows initial setup before the first salon field is saved', () => {
    expect(hasOwnSalon({ pricing_plan: PricingPlanValue.STUDIO })).toBe(true);
    expect(hasOwnSalon({ pricing_plan: PricingPlanValue.SCALE })).toBe(true);
  });
});
