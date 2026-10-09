/**
 * Pure-policy unit test — PRICING_POLICY quota math.
 *
 * Proves the harness runs a kernel policy WITHOUT any mock plumbing: this file
 * imports only `@kernel/policies/pricing.policy` and asserts boundary behavior of
 * `canCreateGalleryRecord`. It is the canonical example of a "pure rule" test (BDX
 * doctrine: test STABLE business rules, not churn).
 *
 * Rule under test (pricing.policy.ts):
 *   canCreateGalleryRecord(config, currentCount) =
 *     config.max_gallery_records === -1 || currentCount < config.max_gallery_records
 */

import { describe, it, expect } from 'vitest';
import {
  PRICING_POLICY,
  PRICING_LIMITS_SSOT,
  narrowPricingPlan,
} from '@kernel/policies/pricing.policy';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';

const { canCreateGalleryRecord, getPlanConfig } = PRICING_POLICY.utils;

describe('PRICING_POLICY.utils.canCreateGalleryRecord (gallery quota boundary)', () => {
  const freeConfig = getPlanConfig(PricingPlanValue.FREE);

  it('allows creation strictly below the FREE limit (limit - 1 → true)', () => {
    // FREE.max_gallery_records is the capped ceiling for demo accounts.
    const limit = PRICING_LIMITS_SSOT.FREE.max_gallery_records;
    expect(canCreateGalleryRecord(freeConfig, limit - 1)).toBe(true);
  });

  it('blocks creation AT the FREE limit (count === limit → false) — `<` boundary', () => {
    // This asserts the `<` comparison, NOT `<=`. The "at limit" case is the exact
    // line a quota bug lives on.
    const limit = PRICING_LIMITS_SSOT.FREE.max_gallery_records;
    expect(canCreateGalleryRecord(freeConfig, limit)).toBe(false);
    // And above the limit stays false.
    expect(canCreateGalleryRecord(freeConfig, limit + 5)).toBe(false);
  });

  it('treats -1 (paid plans) as unlimited — true even at a huge count', () => {
    const proConfig = getPlanConfig(PricingPlanValue.PRO);
    expect(proConfig.max_gallery_records).toBe(-1);
    expect(canCreateGalleryRecord(proConfig, 0)).toBe(true);
    expect(canCreateGalleryRecord(proConfig, 1_000_000)).toBe(true);
  });

  it('narrowPricingPlan falls back to FREE for unknown plan strings', () => {
    expect(narrowPricingPlan('NOT_A_REAL_PLAN')).toBe(PricingPlanValue.FREE);
    expect(narrowPricingPlan(PricingPlanValue.STUDIO)).toBe(
      PricingPlanValue.STUDIO
    );
  });

  // NEGATIVE / REGRESSION GUARD (intentional doc, not a failing test):
  // If someone "simplifies" the comparison in pricing.policy.ts from
  //   `currentCount < config.max_gallery_records`
  // to
  //   `currentCount <= config.max_gallery_records`
  // then the second test ("blocks creation AT the FREE limit") would FLIP:
  // canCreateGalleryRecord(freeConfig, limit) would return `true`, letting a free
  // account create one record PAST its cap (off-by-one quota leak). That test is the
  // red tripwire for that exact regression.
});
