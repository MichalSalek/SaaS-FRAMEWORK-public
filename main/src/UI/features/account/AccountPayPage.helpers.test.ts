// AccountPayPage.helpers.test.ts
// The current-plan card must say what the Stripe mirror fields say: trial,
// scheduled cancellation, failed payment, or a plain active subscription.

import { describe, it, expect } from 'vitest';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { SubscriptionStatusValue } from '@kernel/models/db_models.generated.dto';
import {
  resolvePlanStatusCopy,
  resolvePlanStatusSummary,
  resolveRecommendedPlanId,
} from './AccountPayPage.helpers';

type Input = Parameters<typeof resolvePlanStatusSummary>[0];

// The resolver passes the date through untouched (the card formats it), so a
// Date stands in for the ISO string the wire actually carries.
const iso = (value: string): Date => new Date(value);

const paid = (overrides: Partial<Input> = {}): Input => ({
  pricing_plan: PricingPlanValue.PRO,
  subscription_status: SubscriptionStatusValue.ACTIVE,
  cancel_at_period_end: false,
  cancel_at: null,
  current_period_end: iso('2026-10-24T10:00:00.000Z'),
  trial_ends_at: null,
  ...overrides,
});

describe('resolvePlanStatusSummary', () => {
  it('FREE is free regardless of stale Stripe fields', () => {
    expect(
      resolvePlanStatusSummary(
        paid({
          pricing_plan: PricingPlanValue.FREE,
          subscription_status: SubscriptionStatusValue.CANCELED,
        })
      )
    ).toEqual({ kind: 'free' });
  });

  it('a plain paid subscription is active', () => {
    expect(resolvePlanStatusSummary(paid())).toEqual({ kind: 'active' });
  });

  it('a trial reports its end date', () => {
    const until = iso('2026-10-10T00:00:00.000Z');
    expect(
      resolvePlanStatusSummary(
        paid({
          subscription_status: SubscriptionStatusValue.TRIALING,
          trial_ends_at: until,
        })
      )
    ).toEqual({ kind: 'trialing', until });
  });

  it('a scheduled cancellation reports access until the period end, even mid-trial', () => {
    const periodEnd = iso('2026-10-10T00:00:00.000Z');
    expect(
      resolvePlanStatusSummary(
        paid({
          subscription_status: SubscriptionStatusValue.TRIALING,
          trial_ends_at: periodEnd,
          cancel_at_period_end: true,
          current_period_end: periodEnd,
        })
      )
    ).toEqual({ kind: 'canceling', until: periodEnd });
  });

  it('prefers an explicit cancel_at date', () => {
    const cancelAt = iso('2026-11-01T00:00:00.000Z');
    expect(resolvePlanStatusSummary(paid({ cancel_at: cancelAt }))).toEqual({
      kind: 'canceling',
      until: cancelAt,
    });
  });

  it('a failed renewal payment wins over everything else', () => {
    expect(
      resolvePlanStatusSummary(
        paid({
          subscription_status: SubscriptionStatusValue.PAST_DUE,
          cancel_at_period_end: true,
        })
      )
    ).toEqual({ kind: 'pastDue' });
    expect(
      resolvePlanStatusSummary(
        paid({ subscription_status: SubscriptionStatusValue.UNPAID })
      )
    ).toEqual({ kind: 'pastDue' });
  });

  it('an unfinished first payment (abandoned 3DS) is not an active plan', () => {
    expect(
      resolvePlanStatusSummary(
        paid({ subscription_status: SubscriptionStatusValue.INCOMPLETE })
      )
    ).toEqual({ kind: 'pastDue' });
  });

  it('never claims a dated state without a date', () => {
    expect(
      resolvePlanStatusSummary(
        paid({
          subscription_status: SubscriptionStatusValue.TRIALING,
          trial_ends_at: null,
        })
      )
    ).toEqual({ kind: 'active' });
    expect(
      resolvePlanStatusSummary(
        paid({ cancel_at_period_end: true, current_period_end: null })
      )
    ).toEqual({ kind: 'active' });
  });
});

describe('resolvePlanStatusCopy', () => {
  const now = iso('2026-10-08T12:00:00.000Z').getTime();

  it('Free feeds the intro line only, never the billing card', () => {
    const copy = resolvePlanStatusCopy(null, 'pl', now);
    expect(copy.kind).toBe('free');
    expect(copy.keys).toEqual({
      heroMeta: 'heroMetaFree',
      title: null,
      body: null,
    });
  });

  it('an active subscription names its next payment date', () => {
    const copy = resolvePlanStatusCopy(paid(), 'pl', now);
    expect(copy.keys.title).toBe('billingTitleRenews');
    expect(copy.date).not.toBe('');
  });

  it('a stale or missing period end never prints a date', () => {
    const stale = resolvePlanStatusCopy(
      paid({ current_period_end: iso('2026-09-01T00:00:00.000Z') }),
      'pl',
      now
    );
    expect(stale.keys.title).toBe('billingTitleActive');
    expect(stale.date).toBe('');
    const missing = resolvePlanStatusCopy(
      paid({ current_period_end: null }),
      'pl',
      now
    );
    expect(missing.keys.title).toBe('billingTitleActive');
  });

  it('a failed payment has its own card copy', () => {
    const copy = resolvePlanStatusCopy(
      paid({ subscription_status: SubscriptionStatusValue.PAST_DUE }),
      'pl',
      now
    );
    expect(copy.kind).toBe('pastDue');
    expect(copy.keys.title).toBe('billingTitlePastDue');
  });
});

describe('resolveRecommendedPlanId', () => {
  const plans = [
    { id: 'FREE' },
    { id: 'PRO' },
    { id: 'PRO_PLUS' },
    { id: 'STUDIO', isPopular: true },
    { id: 'SCALE', isCustom: true },
  ] as const;

  it('the popular plan is the filled step while it is an upgrade', () => {
    expect(resolveRecommendedPlanId(plans, 0, 'free')).toBe('STUDIO');
    expect(resolveRecommendedPlanId(plans, 1, 'active')).toBe('STUDIO');
  });

  it('above the popular plan nothing purchasable is left to fill', () => {
    expect(resolveRecommendedPlanId(plans, 3, 'active')).toBeNull();
    expect(resolveRecommendedPlanId(plans, 4, 'active')).toBeNull();
  });

  it('without a popular upgrade the nearest purchasable one is filled', () => {
    const noPopular = plans.map(({ id }) => ({ id }));
    expect(resolveRecommendedPlanId(noPopular, 1, 'trialing')).toBe('PRO_PLUS');
  });

  it('a failed payment fills no plan: billing comes first', () => {
    expect(resolveRecommendedPlanId(plans, 1, 'pastDue')).toBeNull();
  });
});
