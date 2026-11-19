import { describe, expect, it } from 'vitest';
import { resolveEffectivePlan } from '@kernel/domain/pricing/effective-plan';
import { PLAN_TIER_ORDER } from '@kernel/domain/pricing/pricing-policy';
import { PRICING_POLICY } from '@kernel/policies/pricing.policy';

const statuses = [
  'ACTIVE',
  'TRIALING',
  'CANCELED',
  'PAST_DUE',
  'UNPAID',
  'INCOMPLETE',
  'INCOMPLETE_EXPIRED',
  'PAUSED',
  null,
];
describe('effective salon plan', () => {
  for (const own of PLAN_TIER_ORDER) {
    for (const salon of PLAN_TIER_ORDER) {
      for (const status of statuses) {
        for (const active of [true, false]) {
          for (const accepted of [true, false]) {
            it(`${own}/${salon}/${status}/${active}/${accepted}`, () => {
              const result = resolveEffectivePlan(own, [
                {
                  accepted_at: accepted ? new Date() : null,
                  is_active: active,
                  owner_plan: salon,
                  owner_subscription_status: status,
                  salon_account_id: 'salon',
                  salon_name: 'Salon',
                },
              ]);
              const eligible =
                active &&
                accepted &&
                status === 'ACTIVE' &&
                ['STUDIO', 'SCALE'].includes(salon);
              const expected =
                eligible &&
                PLAN_TIER_ORDER.indexOf(salon) > PLAN_TIER_ORDER.indexOf(own)
                  ? salon
                  : own;
              expect(result.effective_pricing_plan).toBe(expected);
              expect(result.salon_plan !== null).toBe(eligible);
              const actual = PRICING_POLICY.utils.getPlanConfig(
                result.effective_pricing_plan
              );
              const config = PRICING_POLICY.utils.getPlanConfig(expected);
              expect(actual.max_gallery_records).toBe(
                config.max_gallery_records
              );
              expect(actual.max_paired_clients).toBe(config.max_paired_clients);
              expect(actual.max_pinned_records).toBe(config.max_pinned_records);
              expect(PRICING_POLICY.utils.canViewHistory(actual)).toBe(
                PRICING_POLICY.utils.canViewHistory(config)
              );
            });
          }
        }
      }
    }
  }
  it('falls back without deleting or mutating the own plan', () => {
    expect(resolveEffectivePlan('PRO', [])).toEqual({
      effective_pricing_plan: 'PRO',
      salon_plan: null,
    });
  });
  it('takes highest available salon and preserves higher own Scale', () => {
    const rows = ['STUDIO', 'SCALE'].map(plan => ({
      accepted_at: new Date(),
      is_active: true,
      owner_plan: plan as 'STUDIO' | 'SCALE',
      owner_subscription_status: 'ACTIVE',
      salon_account_id: plan,
      salon_name: plan,
    }));
    expect(resolveEffectivePlan('FREE', rows).effective_pricing_plan).toBe(
      'SCALE'
    );
    expect(resolveEffectivePlan('SCALE', rows).effective_pricing_plan).toBe(
      'SCALE'
    );
  });
});
