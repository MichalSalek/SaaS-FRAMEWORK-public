import { describe, expect, it } from 'vitest';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { SubscriptionStatusValue } from '@kernel/models/db_models.generated.dto';
import {
  planHubStatus,
  formatPlanCharge,
  showPlanUpgrade,
} from './AccountPlan.helpers';

const account = {
  pricing_plan: PricingPlanValue.STUDIO,
  subscription_status: SubscriptionStatusValue.TRIALING,
  cancel_at_period_end: false,
  cancel_at: null,
  current_period_end: '2026-10-23T10:00:00.000Z',
  trial_ends_at: '2026-10-23T10:00:00.000Z',
};
describe('plan hub facts', () => {
  it('names a twelve-day trial and formats an unbreakable date', () => {
    expect(
      planHubStatus(account, 'pl', Date.parse('2026-10-11T10:00:00Z'))
    ).toEqual({
      kind: 'trialing',
      days: 12,
      date: '23\u00a0października\u00a02026',
    });
  });
  it('a canceled trial stops promising conversion', () => {
    expect(
      planHubStatus({ ...account, cancel_at_period_end: true }, 'pl').kind
    ).toBe('canceling');
  });
  it('keeps unavailable billing amounts distinct from a zero charge', () => {
    expect(formatPlanCharge(null, 'pln', 'pl')).toBeNull();
    expect(formatPlanCharge(0, 'pln', 'pl')).toBe('0\u00a0PLN');
    expect(formatPlanCharge(12177, 'pln', 'pl')).toBe('121,77\u00a0PLN');
  });
});

describe('plan hub upgrade', () => {
  it.each([
    [PricingPlanValue.FREE, true],
    [PricingPlanValue.PRO, true],
    [PricingPlanValue.PRO_PLUS, true],
    [PricingPlanValue.STUDIO, false],
    [PricingPlanValue.SCALE, false],
  ] as const)('supports a self-service tier above %s: %s', (plan, expected) => {
    expect(showPlanUpgrade(plan, 'active', false)).toBe(expected);
    expect(showPlanUpgrade(plan, 'trialing', false)).toBe(expected);
  });

  it('treats a free state as Free even when a former paid plan remains', () => {
    expect(showPlanUpgrade(PricingPlanValue.SCALE, 'free', false)).toBe(true);
  });

  it.each(['pastDue', 'canceling'] as const)(
    'preserves recovery for %s',
    status => {
      expect(showPlanUpgrade(PricingPlanValue.PRO, status, false)).toBe(false);
    }
  );

  it('does not offer an upgrade to a salon-only member', () => {
    expect(showPlanUpgrade(PricingPlanValue.FREE, 'free', true)).toBe(false);
    expect(showPlanUpgrade(PricingPlanValue.PRO, 'active', false)).toBe(true);
  });
});
