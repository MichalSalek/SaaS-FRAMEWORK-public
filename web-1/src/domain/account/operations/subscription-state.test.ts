import { describe, expect, it } from 'vitest';
import { resolveSubscriptionState } from '@kernel/domain/user-and-account/subscription-state';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import type { SafeStylistAccount } from '@kernel/models/session/session.dto';

const account = {
  pricing_plan: PricingPlanValue.STUDIO,
  subscription_status: 'ACTIVE',
  cancel_at_period_end: false,
  cancel_at: null,
} satisfies Parameters<typeof resolveSubscriptionState>[0];

describe('subscription state truth', () => {
  it.each(['ACTIVE', 'TRIALING', 'PAST_DUE'] as const)(
    'Free is Free with stale status %s',
    subscription_status => {
      expect(
        resolveSubscriptionState({
          ...account,
          pricing_plan: PricingPlanValue.FREE,
          subscription_status,
        })
      ).toBe('free');
    }
  );
  it.each<[SafeStylistAccount['subscription_status'], boolean, string]>([
    ['ACTIVE', false, 'active'],
    ['TRIALING', false, 'trialing'],
    ['ACTIVE', true, 'canceling'],
    ['TRIALING', true, 'canceling'],
    ['PAST_DUE', false, 'past_due'],
    ['UNPAID', true, 'past_due'],
    ['INCOMPLETE', false, 'past_due'],
    ['CANCELED', false, 'free'],
    ['INCOMPLETE_EXPIRED', false, 'free'],
    ['PAUSED', false, 'free'],
  ])(
    '%s cancel=%s resolves %s',
    (subscription_status, cancel_at_period_end, expected) => {
      expect(
        resolveSubscriptionState({
          ...account,
          subscription_status,
          cancel_at_period_end,
        })
      ).toBe(expected);
    }
  );
  it('explicit cancellation date counts even without the period-end flag', () => {
    expect(
      resolveSubscriptionState({ ...account, cancel_at: new Date() })
    ).toBe('canceling');
  });
});
