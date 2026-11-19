import { describe, expect, it } from 'vitest';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { SubscriptionStatusValue } from '@kernel/models/db_models.generated.dto';
import { resolveDashboardPlanLine } from './dashboard-plan.helpers';

type Account = Parameters<typeof resolveDashboardPlanLine>[0];
const now = new Date('2026-10-11T10:00:00Z').getTime();
const end = '2026-10-23T10:00:00.000Z';
const paid = (overrides: Partial<Account> = {}): Account => ({
  pricing_plan: PricingPlanValue.STUDIO,
  subscription_status: SubscriptionStatusValue.ACTIVE,
  cancel_at_period_end: false,
  cancel_at: null,
  current_period_end: end,
  trial_ends_at: null,
  ...overrides,
});

describe('dashboard plan line', () => {
  it('shows salon plan instead of Free and identifies its source', () => {
    const line = resolveDashboardPlanLine(
      paid({
        pricing_plan: 'FREE',
        effective_pricing_plan: 'STUDIO',
        salon_plan: {
          salon_account_id: 'salon',
          salon_name: 'Salon',
          pricing_plan: 'STUDIO',
        },
      }),
      'pl',
      now
    );
    expect(line).toMatchObject({
      key: 'salonMember',
      values: { plan: 'Studio', salon: 'Salon' },
    });
  });
  it('keeps both salon entitlement and own paid subscription visible', () => {
    const line = resolveDashboardPlanLine(
      paid({
        pricing_plan: 'PRO',
        effective_pricing_plan: 'STUDIO',
        salon_plan: {
          salon_account_id: 'salon',
          salon_name: 'Salon',
          pricing_plan: 'STUDIO',
        },
      }),
      'pl',
      now
    );
    expect(line).toMatchObject({
      key: 'salonMemberWithOwn',
      values: { plan: 'Studio', ownPlan: 'Pro' },
    });
  });
  it('names Free Demo', () => {
    expect(
      resolveDashboardPlanLine(
        paid({ pricing_plan: PricingPlanValue.FREE }),
        'pl',
        now
      )
    ).toMatchObject({ key: 'free', values: { plan: 'Free Demo' } });
  });
  it('does not show a stale paid plan after the subscription ended', () => {
    expect(
      resolveDashboardPlanLine(
        paid({ subscription_status: SubscriptionStatusValue.CANCELED }),
        'pl',
        now
      )
    ).toMatchObject({ key: 'free', values: { plan: 'Free Demo' } });
  });
  it('names an active paid plan', () => {
    expect(resolveDashboardPlanLine(paid(), 'pl', now)).toMatchObject({
      key: 'active',
      values: { plan: 'Studio' },
    });
  });
  it('keeps the entire trial date and counts twelve days outside urgency window', () => {
    expect(
      resolveDashboardPlanLine(
        paid({
          subscription_status: SubscriptionStatusValue.TRIALING,
          trial_ends_at: end,
        }),
        'pl',
        now
      )
    ).toEqual({
      key: 'trialing',
      values: {
        plan: 'Studio',
        date: '23\u00a0października\u00a02026',
        days: 12,
      },
    });
  });
  it('shows cancellation rather than a converting trial', () => {
    expect(
      resolveDashboardPlanLine(
        paid({
          subscription_status: SubscriptionStatusValue.TRIALING,
          trial_ends_at: end,
          cancel_at_period_end: true,
        }),
        'pl',
        now
      )
    ).toMatchObject({
      key: 'cancelingTrial',
      values: { date: '23\u00a0października\u00a02026' },
    });
  });
  it('shows when paid cancellation ends', () => {
    expect(
      resolveDashboardPlanLine(paid({ cancel_at_period_end: true }), 'pl', now)
        .key
    ).toBe('canceling');
  });
  it('prioritizes failed payment over cancellation', () => {
    expect(
      resolveDashboardPlanLine(
        paid({
          subscription_status: SubscriptionStatusValue.PAST_DUE,
          cancel_at_period_end: true,
        }),
        'pl',
        now
      ).key
    ).toBe('pastDue');
  });
  it('never produces negative trial days', () => {
    expect(
      resolveDashboardPlanLine(
        paid({
          subscription_status: SubscriptionStatusValue.TRIALING,
          trial_ends_at: end,
        }),
        'pl',
        Date.parse(end) + 1
      ).values.days
    ).toBe(0);
  });
});
