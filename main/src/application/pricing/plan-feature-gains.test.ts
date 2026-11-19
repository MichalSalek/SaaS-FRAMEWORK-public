import { describe, expect, it } from 'vitest';
import { PricingPlanValue as Plan } from '@kernel/domain/pricing/pricing.config';
import { planFeatureGains } from './plan-feature-gains';
import { planFeatureValue } from './plan-features.catalog';

describe('actual current-plan gains', () => {
  it('keeps downgrade and interval-only decisions free of upgrade claims', () => {
    expect(planFeatureGains(Plan.STUDIO, Plan.PRO_PLUS)).toEqual([]);
    expect(planFeatureGains(Plan.PRO, Plan.PRO)).toEqual([]);
  });

  it('compares a skipped tier with the actual current plan and caps the header', () => {
    const gains = planFeatureGains(Plan.FREE, Plan.STUDIO);
    expect(gains.length).toBeGreaterThan(0);
    expect(gains.length).toBeLessThanOrEqual(3);
    expect(gains.some(line => line.id === 'gallery')).toBe(true);
    for (const line of gains) {
      expect(planFeatureValue(line.id, Plan.STUDIO)).not.toEqual(
        planFeatureValue(line.id, Plan.FREE)
      );
    }
  });
});
