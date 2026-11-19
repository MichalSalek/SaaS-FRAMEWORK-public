import { describe, it, expect } from 'vitest';
import { PaymentStatusValue } from '@kernel/models/db_models.generated.dto';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import {
  PLAN_TIER_ORDER,
  canStartTrial,
  isPlanDowngrade,
} from '@kernel/domain/pricing/pricing-policy';

describe('canStartTrial', () => {
  it('allows trial for a never-subscribed UNPAID account', () => {
    expect(
      canStartTrial({
        trialStartedAt: null,
        paymentStatus: PaymentStatusValue.UNPAID,
      })
    ).toBe(true);
  });

  it('allows trial for a REJECTED account', () => {
    expect(
      canStartTrial({
        trialStartedAt: null,
        paymentStatus: PaymentStatusValue.REJECTED,
      })
    ).toBe(true);
  });

  it('denies trial for a PAID (active) subscriber', () => {
    expect(
      canStartTrial({
        trialStartedAt: null,
        paymentStatus: PaymentStatusValue.PAID,
      })
    ).toBe(false);
  });

  it('denies trial while checkout is IN_PROGRESS', () => {
    expect(
      canStartTrial({
        trialStartedAt: null,
        paymentStatus: PaymentStatusValue.IN_PROGRESS,
      })
    ).toBe(false);
  });

  it('denies trial once the one-time trial was already claimed', () => {
    expect(
      canStartTrial({
        trialStartedAt: '2026-01-01T00:00:00.000Z',
        paymentStatus: PaymentStatusValue.UNPAID,
      })
    ).toBe(false);
  });

  it('denies trial when payment status is unknown/undefined', () => {
    expect(
      canStartTrial({ trialStartedAt: null, paymentStatus: undefined })
    ).toBe(false);
  });
});

describe('isPlanDowngrade', () => {
  it('treats a move to a lower tier as a downgrade', () => {
    expect(isPlanDowngrade(PricingPlanValue.PRO, PricingPlanValue.FREE)).toBe(
      true
    );
    expect(
      isPlanDowngrade(PricingPlanValue.SCALE, PricingPlanValue.STUDIO)
    ).toBe(true);
  });

  it('does not treat a move to a higher tier as a downgrade', () => {
    expect(isPlanDowngrade(PricingPlanValue.FREE, PricingPlanValue.PRO)).toBe(
      false
    );
    expect(
      isPlanDowngrade(PricingPlanValue.STUDIO, PricingPlanValue.SCALE)
    ).toBe(false);
  });

  it('does not treat a same-tier move as a downgrade', () => {
    expect(isPlanDowngrade(PricingPlanValue.PRO, PricingPlanValue.PRO)).toBe(
      false
    );
  });
});

describe('PLAN_TIER_ORDER', () => {
  it('lists all five tiers low → high', () => {
    expect(PLAN_TIER_ORDER).toEqual([
      PricingPlanValue.FREE,
      PricingPlanValue.PRO,
      PricingPlanValue.PRO_PLUS,
      PricingPlanValue.STUDIO,
      PricingPlanValue.SCALE,
    ]);
  });
});
