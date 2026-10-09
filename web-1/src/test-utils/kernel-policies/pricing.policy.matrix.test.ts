/**
 * Golden-master MATRIX test for PRICING_POLICY quota functions (BDX W0.2 part B).
 *
 * This file extends pricing.policy.test.ts (which covers canCreateGalleryRecord in
 * depth) with a full TIER × QUOTA-FUNCTION matrix. It is the golden master for W3.3:
 * if limits change in PRICING_LIMITS_SSOT, these tests surface the drift immediately.
 *
 * Tiers covered: FREE / PRO / PRO_PLUS / STUDIO / SCALE (all 5 from PRICING_LIMITS_SSOT)
 *
 * Quota functions under test (STYLIST per-plan):
 *   - canCreateGalleryRecord(config, count) — max_gallery_records
 *   - canPairClient(config, count)          — max_paired_clients
 *   - canPinGalleryRecord(config, count)    — max_pinned_records
 *   - canShareSession(config, count)        — can_use_session_share + max_shares_per_hour
 *
 * Quota function under test (CLIENT platform):
 *   - canPairStylist(count)                — PLATFORM_LIMITS.MAX_PAIRED_STYLISTS
 *
 * Boundary contract for every quota function f(config, count):
 *   - count = limit - 1  → true  (strictly below → allowed)
 *   - count = limit      → false (AT limit → blocked; operator is `<`, not `<=`)
 *   - count > limit      → false (above limit → blocked)
 *   - limit = -1         → always true (unlimited)
 *
 * getPlanConfig / narrowPricingPlan:
 *   - unknown plan string → fail-safe FREE
 *   - known plans pass through unchanged
 *
 * NEGATIVE / REGRESSION GUARD:
 *   If a developer changes `currentCount < config.max_X` to `currentCount <= config.max_X`,
 *   the "AT limit → false" assertions below FLIP to true, revealing the off-by-one quota
 *   leak. The matrix is deliberately repetitive across tiers so the tripwire is broad.
 */

import { describe, it, expect } from 'vitest';
import {
  PRICING_POLICY,
  PRICING_LIMITS_SSOT,
  PLATFORM_LIMITS,
  narrowPricingPlan,
} from '@kernel/policies/pricing.policy';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';

const {
  canCreateGalleryRecord,
  canPairClient,
  canPinGalleryRecord,
  canShareSession,
  canPairStylist,
  getPlanConfig,
} = PRICING_POLICY.utils;

// ─── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Assert the standard boundary contract for any quota function that takes
 * (config, count) and a finite limit from the plan config.
 *
 * Works for: canCreateGalleryRecord, canPairClient, canPinGalleryRecord.
 */
function assertQuotaBoundary(
  fn: (limit: number) => boolean,
  limit: number,
  fnName: string,
  tier: string
): void {
  expect(fn(limit - 1), `${tier}.${fnName}: count=limit-1 → true`).toBe(true);
  expect(fn(limit), `${tier}.${fnName}: count=limit → false`).toBe(false);
  expect(fn(limit + 5), `${tier}.${fnName}: count=limit+5 → false`).toBe(false);
}

/**
 * Assert unlimited (-1) behavior: always true regardless of count.
 */
function assertUnlimited(
  fn: (count: number) => boolean,
  fnName: string,
  tier: string
): void {
  expect(fn(0), `${tier}.${fnName}: unlimited, count=0 → true`).toBe(true);
  expect(fn(100), `${tier}.${fnName}: unlimited, count=100 → true`).toBe(true);
  expect(fn(1_000_000), `${tier}.${fnName}: unlimited, count=1M → true`).toBe(
    true
  );
}

// ─── canCreateGalleryRecord matrix ──────────────────────────────────────────────

describe('PRICING_POLICY.utils.canCreateGalleryRecord — full tier matrix', () => {
  const TIER = 'canCreateGalleryRecord';

  it('FREE: boundary limit=5 (limit-1→true, limit→false, limit+5→false)', () => {
    const config = getPlanConfig(PricingPlanValue.FREE);
    const limit = PRICING_LIMITS_SSOT.FREE.max_gallery_records; // 5
    expect(limit).toBe(5);
    assertQuotaBoundary(
      c => canCreateGalleryRecord(config, c),
      limit,
      TIER,
      'FREE'
    );
  });

  it('PRO: unlimited (-1) — always true at any count', () => {
    const config = getPlanConfig(PricingPlanValue.PRO);
    expect(config.max_gallery_records).toBe(-1);
    assertUnlimited(c => canCreateGalleryRecord(config, c), TIER, 'PRO');
  });

  it('PRO_PLUS: unlimited (-1) — always true at any count', () => {
    const config = getPlanConfig(PricingPlanValue.PRO_PLUS);
    expect(config.max_gallery_records).toBe(-1);
    assertUnlimited(c => canCreateGalleryRecord(config, c), TIER, 'PRO_PLUS');
  });

  it('STUDIO: unlimited (-1) — always true at any count', () => {
    const config = getPlanConfig(PricingPlanValue.STUDIO);
    expect(config.max_gallery_records).toBe(-1);
    assertUnlimited(c => canCreateGalleryRecord(config, c), TIER, 'STUDIO');
  });

  it('SCALE: unlimited (-1) — always true at any count', () => {
    const config = getPlanConfig(PricingPlanValue.SCALE);
    expect(config.max_gallery_records).toBe(-1);
    assertUnlimited(c => canCreateGalleryRecord(config, c), TIER, 'SCALE');
  });
});

// ─── canPairClient matrix ────────────────────────────────────────────────────────

describe('PRICING_POLICY.utils.canPairClient — full tier matrix', () => {
  const TIER_FN = 'canPairClient';

  it('FREE: boundary limit=2 (limit-1→true, limit→false)', () => {
    const config = getPlanConfig(PricingPlanValue.FREE);
    const limit = PRICING_LIMITS_SSOT.FREE.max_paired_clients; // 2
    expect(limit).toBe(2);
    assertQuotaBoundary(c => canPairClient(config, c), limit, TIER_FN, 'FREE');
  });

  it('PRO: unlimited (-1) — always true at any count', () => {
    const config = getPlanConfig(PricingPlanValue.PRO);
    expect(config.max_paired_clients).toBe(-1);
    assertUnlimited(c => canPairClient(config, c), TIER_FN, 'PRO');
  });

  it('PRO_PLUS: unlimited (-1) — always true at any count', () => {
    const config = getPlanConfig(PricingPlanValue.PRO_PLUS);
    expect(config.max_paired_clients).toBe(-1);
    assertUnlimited(c => canPairClient(config, c), TIER_FN, 'PRO_PLUS');
  });

  it('STUDIO: unlimited (-1) — always true at any count', () => {
    const config = getPlanConfig(PricingPlanValue.STUDIO);
    expect(config.max_paired_clients).toBe(-1);
    assertUnlimited(c => canPairClient(config, c), TIER_FN, 'STUDIO');
  });

  it('SCALE: unlimited (-1) — always true at any count', () => {
    const config = getPlanConfig(PricingPlanValue.SCALE);
    expect(config.max_paired_clients).toBe(-1);
    assertUnlimited(c => canPairClient(config, c), TIER_FN, 'SCALE');
  });
});

// ─── canPinGalleryRecord matrix ───────────────────────────────────────────────────

describe('PRICING_POLICY.utils.canPinGalleryRecord — full tier matrix', () => {
  const TIER_FN = 'canPinGalleryRecord';

  it('FREE: boundary limit=3 (limit-1→true, limit→false)', () => {
    const config = getPlanConfig(PricingPlanValue.FREE);
    const limit = PRICING_LIMITS_SSOT.FREE.max_pinned_records; // 3
    expect(limit).toBe(3);
    assertQuotaBoundary(
      c => canPinGalleryRecord(config, c),
      limit,
      TIER_FN,
      'FREE'
    );
  });

  it('PRO: boundary limit=10 (limit-1→true, limit→false)', () => {
    const config = getPlanConfig(PricingPlanValue.PRO);
    const limit = PRICING_LIMITS_SSOT.PRO.max_pinned_records; // 10
    expect(limit).toBe(10);
    assertQuotaBoundary(
      c => canPinGalleryRecord(config, c),
      limit,
      TIER_FN,
      'PRO'
    );
  });

  it('PRO_PLUS: boundary limit=15 (limit-1→true, limit→false)', () => {
    const config = getPlanConfig(PricingPlanValue.PRO_PLUS);
    const limit = PRICING_LIMITS_SSOT.PRO_PLUS.max_pinned_records; // 15
    expect(limit).toBe(15);
    assertQuotaBoundary(
      c => canPinGalleryRecord(config, c),
      limit,
      TIER_FN,
      'PRO_PLUS'
    );
  });

  it('STUDIO: boundary limit=30 (limit-1→true, limit→false)', () => {
    const config = getPlanConfig(PricingPlanValue.STUDIO);
    const limit = PRICING_LIMITS_SSOT.STUDIO.max_pinned_records; // 30
    expect(limit).toBe(30);
    assertQuotaBoundary(
      c => canPinGalleryRecord(config, c),
      limit,
      TIER_FN,
      'STUDIO'
    );
  });

  it('SCALE: boundary limit=50 (limit-1→true, limit→false)', () => {
    const config = getPlanConfig(PricingPlanValue.SCALE);
    const limit = PRICING_LIMITS_SSOT.SCALE.max_pinned_records; // 50
    expect(limit).toBe(50);
    assertQuotaBoundary(
      c => canPinGalleryRecord(config, c),
      limit,
      TIER_FN,
      'SCALE'
    );
  });
});

// ─── canShareSession matrix ───────────────────────────────────────────────────────

describe('PRICING_POLICY.utils.canShareSession — full tier matrix', () => {
  const TIER_FN = 'canShareSession';

  it('FREE: can_use_session_share=true, limit=5 → boundary (limit-1→true, limit→false)', () => {
    const config = getPlanConfig(PricingPlanValue.FREE);
    expect(config.can_use_session_share).toBe(true);
    const limit = PRICING_LIMITS_SSOT.FREE.max_shares_per_hour; // 5
    expect(limit).toBe(5);
    assertQuotaBoundary(
      c => canShareSession(config, c),
      limit,
      TIER_FN,
      'FREE'
    );
  });

  it('PRO: can_use_session_share=true, limit=20 → boundary (limit-1→true, limit→false)', () => {
    const config = getPlanConfig(PricingPlanValue.PRO);
    expect(config.can_use_session_share).toBe(true);
    const limit = PRICING_LIMITS_SSOT.PRO.max_shares_per_hour; // 20
    expect(limit).toBe(20);
    assertQuotaBoundary(c => canShareSession(config, c), limit, TIER_FN, 'PRO');
  });

  it('PRO_PLUS: can_use_session_share=true, limit=20 → boundary', () => {
    const config = getPlanConfig(PricingPlanValue.PRO_PLUS);
    expect(config.can_use_session_share).toBe(true);
    const limit = PRICING_LIMITS_SSOT.PRO_PLUS.max_shares_per_hour; // 20
    expect(limit).toBe(20);
    assertQuotaBoundary(
      c => canShareSession(config, c),
      limit,
      TIER_FN,
      'PRO_PLUS'
    );
  });

  it('STUDIO: can_use_session_share=true, unlimited (-1) → always true', () => {
    const config = getPlanConfig(PricingPlanValue.STUDIO);
    expect(config.can_use_session_share).toBe(true);
    expect(config.max_shares_per_hour).toBe(-1);
    assertUnlimited(c => canShareSession(config, c), TIER_FN, 'STUDIO');
  });

  it('SCALE: can_use_session_share=true, unlimited (-1) → always true', () => {
    const config = getPlanConfig(PricingPlanValue.SCALE);
    expect(config.can_use_session_share).toBe(true);
    expect(config.max_shares_per_hour).toBe(-1);
    assertUnlimited(c => canShareSession(config, c), TIER_FN, 'SCALE');
  });
});

// ─── canPairStylist — platform limit (client-side) ──────────────────────────────

describe('PRICING_POLICY.utils.canPairStylist — platform limit matrix', () => {
  it('platform MAX_PAIRED_STYLISTS=3 → boundary (limit-1→true, limit→false, above→false)', () => {
    const limit = PLATFORM_LIMITS.MAX_PAIRED_STYLISTS; // 3
    expect(limit).toBe(3);
    expect(canPairStylist(limit - 1)).toBe(true); // 2 → true
    expect(canPairStylist(limit)).toBe(false); // 3 → false (AT limit is blocked)
    expect(canPairStylist(limit + 5)).toBe(false); // 8 → false
  });

  it('canPairStylist(0) → always true (empty, below any limit)', () => {
    expect(canPairStylist(0)).toBe(true);
  });

  it('canPairStylist: returns false for counts at or above platform limit', () => {
    // Exhaustive small set to cover edge cases.
    expect(canPairStylist(3)).toBe(false);
    expect(canPairStylist(4)).toBe(false);
    expect(canPairStylist(100)).toBe(false);
  });

  // NEGATIVE / REGRESSION GUARD:
  // If MAX_PAIRED_STYLISTS is changed to -1 (unlimited), canPairStylist would always
  // return true. The `expect(limit).toBe(3)` assertion above is the tripwire: it fails
  // before the boundary tests run, flagging the SSOT change immediately.
});

// ─── getPlanConfig / narrowPricingPlan ──────────────────────────────────────────

describe('getPlanConfig and narrowPricingPlan', () => {
  it('getPlanConfig returns correct plan_id for each tier', () => {
    expect(getPlanConfig(PricingPlanValue.FREE).plan_id).toBe('FREE');
    expect(getPlanConfig(PricingPlanValue.PRO).plan_id).toBe('PRO');
    expect(getPlanConfig(PricingPlanValue.PRO_PLUS).plan_id).toBe('PRO_PLUS');
    expect(getPlanConfig(PricingPlanValue.STUDIO).plan_id).toBe('STUDIO');
    expect(getPlanConfig(PricingPlanValue.SCALE).plan_id).toBe('SCALE');
  });

  it('getPlanConfig unknown plan → fail-safe FREE (plan_id stays the passed value, limits from FREE)', () => {
    // The DECISION: unknown plan → FREE limits (fail-safe).
    // getPlanConfig(key in SSOT ? key : 'FREE') — plan_id is passed-through as-is.
    // For any unknown key TypeScript would not allow calling at runtime; this tests
    // the runtime guard path by casting.
    const config = getPlanConfig('UNKNOWN_TIER' as PricingPlan);
    // plan_id reflects what was passed, limits come from FREE
    expect(config.max_gallery_records).toBe(
      PRICING_LIMITS_SSOT.FREE.max_gallery_records
    );
    expect(config.max_paired_clients).toBe(
      PRICING_LIMITS_SSOT.FREE.max_paired_clients
    );
    expect(config.max_pinned_records).toBe(
      PRICING_LIMITS_SSOT.FREE.max_pinned_records
    );
  });

  it('narrowPricingPlan falls back to FREE for unknown strings', () => {
    expect(narrowPricingPlan('NOT_A_PLAN')).toBe(PricingPlanValue.FREE);
    expect(narrowPricingPlan('')).toBe(PricingPlanValue.FREE);
    expect(narrowPricingPlan('pro')).toBe(PricingPlanValue.FREE); // case-sensitive
  });

  it('narrowPricingPlan passes through all known valid PricingPlan values', () => {
    expect(narrowPricingPlan(PricingPlanValue.FREE)).toBe(
      PricingPlanValue.FREE
    );
    expect(narrowPricingPlan(PricingPlanValue.PRO)).toBe(PricingPlanValue.PRO);
    expect(narrowPricingPlan(PricingPlanValue.PRO_PLUS)).toBe(
      PricingPlanValue.PRO_PLUS
    );
    expect(narrowPricingPlan(PricingPlanValue.STUDIO)).toBe(
      PricingPlanValue.STUDIO
    );
    expect(narrowPricingPlan(PricingPlanValue.SCALE)).toBe(
      PricingPlanValue.SCALE
    );
  });

  // NEGATIVE / REGRESSION GUARD:
  // If someone "simplifies" any boundary check from `count < config.max_X` to
  // `count <= config.max_X`, the "AT limit → false" assertions throughout this file
  // FLIP to true, revealing the off-by-one quota leak (an extra record/client/pin
  // would be allowed past the plan cap). The matrix tests are deliberately broad so
  // the regression is caught for every tier and function simultaneously.
});
