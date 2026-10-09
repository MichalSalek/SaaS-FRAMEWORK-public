/**
 * Audience predicates and the catch-up window for the trial sweep.
 * Pure: no I/O.
 */

import { describe, expect, it } from 'vitest';
import { TIME } from '@kernel/application/constants.config';
import {
  EMAIL_LIFECYCLE_CONFIG,
  POST_TRIAL_AUDIENCE_WINDOW_DAYS,
  TRIAL_EMAIL_SCHEDULE,
} from '@kernel/domain/email/email-schedule.config';
import { TRIAL_CONFIG } from '@kernel/domain/stripe/stripe.config';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import {
  PaymentStatusValue,
  SubscriptionStatusValue,
} from '@kernel/models/db_models.generated.dto';
import {
  isInActiveStripeTrial,
  isNonConvertedAfterTrial,
  isTrialConverted,
  isTrialRuleWithinCatchupWindow,
  trialDueStartWindows,
} from './trial-audience.policy';
import { calculateTrialDay } from './trial-email.resolver';

const DAY = TIME.MS_PER_DAY;

describe('POST_TRIAL_AUDIENCE_WINDOW_DAYS', () => {
  it('is the largest post-trial offset plus catch-up plus one floor day', () => {
    const postTrialDays = TRIAL_EMAIL_SCHEDULE.map(
      rule => rule.triggerDay
    ).filter(day => day >= TRIAL_CONFIG.DURATION_DAYS);
    const largest = postTrialDays.reduce(
      (max, day) => (day > max ? day : max),
      TRIAL_CONFIG.DURATION_DAYS
    );
    expect(POST_TRIAL_AUDIENCE_WINDOW_DAYS).toBe(
      largest -
        TRIAL_CONFIG.DURATION_DAYS +
        EMAIL_LIFECYCLE_CONFIG.CATCHUP_WINDOW_DAYS +
        1
    );
  });
});

describe('isTrialConverted', () => {
  it('is true only for ACTIVE + PAID on a non-FREE plan', () => {
    expect(
      isTrialConverted({
        subscription_status: SubscriptionStatusValue.ACTIVE,
        payment_status: PaymentStatusValue.PAID,
        pricing_plan: PricingPlanValue.PRO,
      })
    ).toBe(true);
  });

  it('is false for a live trial (TRIALING maps to PAID)', () => {
    expect(
      isTrialConverted({
        subscription_status: SubscriptionStatusValue.TRIALING,
        payment_status: PaymentStatusValue.PAID,
        pricing_plan: PricingPlanValue.PRO,
      })
    ).toBe(false);
  });

  it('is false when the plan dropped to FREE', () => {
    expect(
      isTrialConverted({
        subscription_status: SubscriptionStatusValue.ACTIVE,
        payment_status: PaymentStatusValue.PAID,
        pricing_plan: PricingPlanValue.FREE,
      })
    ).toBe(false);
  });
});

describe('isNonConvertedAfterTrial', () => {
  it('rejects a converted account', () => {
    expect(
      isNonConvertedAfterTrial({
        subscription_status: SubscriptionStatusValue.ACTIVE,
        payment_status: PaymentStatusValue.PAID,
        pricing_plan: PricingPlanValue.PRO,
      })
    ).toBe(false);
  });

  it('rejects still-TRIALING (conversion webhook has not landed)', () => {
    expect(
      isNonConvertedAfterTrial({
        subscription_status: SubscriptionStatusValue.TRIALING,
        payment_status: PaymentStatusValue.PAID,
        pricing_plan: PricingPlanValue.PRO,
      })
    ).toBe(false);
  });

  it('accepts canceled, FREE, and a failed payment', () => {
    expect(
      isNonConvertedAfterTrial({
        subscription_status: SubscriptionStatusValue.CANCELED,
        payment_status: PaymentStatusValue.UNPAID,
        pricing_plan: PricingPlanValue.FREE,
      })
    ).toBe(true);
    expect(
      isNonConvertedAfterTrial({
        subscription_status: SubscriptionStatusValue.PAST_DUE,
        payment_status: PaymentStatusValue.IN_PROGRESS,
        pricing_plan: PricingPlanValue.PRO,
      })
    ).toBe(true);
    expect(
      isNonConvertedAfterTrial({
        subscription_status: SubscriptionStatusValue.ACTIVE,
        payment_status: PaymentStatusValue.PAID,
        pricing_plan: PricingPlanValue.FREE,
      })
    ).toBe(true);
  });
});

describe('isInActiveStripeTrial', () => {
  const now = new Date('2026-09-10T12:00:00.000Z');

  it('requires TRIALING and trial_ends_at in the future', () => {
    expect(
      isInActiveStripeTrial(
        {
          trial_ends_at: new Date(now.getTime() + DAY),
          subscription_status: SubscriptionStatusValue.TRIALING,
        },
        now
      )
    ).toBe(true);
  });

  it('rejects null subscription_status and an ended clock', () => {
    expect(
      isInActiveStripeTrial(
        {
          trial_ends_at: new Date(now.getTime() + DAY),
          subscription_status: null,
        },
        now
      )
    ).toBe(false);
    expect(
      isInActiveStripeTrial(
        {
          trial_ends_at: new Date(now.getTime() - DAY),
          subscription_status: SubscriptionStatusValue.TRIALING,
        },
        now
      )
    ).toBe(false);
  });
});

describe('isTrialRuleWithinCatchupWindow', () => {
  it('allows the trigger day and the next CATCHUP_WINDOW_DAYS', () => {
    expect(isTrialRuleWithinCatchupWindow(14, 14)).toBe(true);
    expect(isTrialRuleWithinCatchupWindow(16, 14)).toBe(true);
  });

  it('skips a future rule and a rule older than the window', () => {
    expect(isTrialRuleWithinCatchupWindow(13, 14)).toBe(false);
    expect(isTrialRuleWithinCatchupWindow(17, 14)).toBe(false);
    expect(isTrialRuleWithinCatchupWindow(15, 1)).toBe(false);
  });
});

describe('trialDueStartWindows', () => {
  const now = new Date('2026-09-23T12:00:00Z');
  const triggerDays = TRIAL_EMAIL_SCHEDULE.map(rule => rule.triggerDay);
  const windows = trialDueStartWindows(triggerDays, now);
  const inWindows = (start: Date) =>
    windows.some(
      w =>
        start.getTime() > w.gt.getTime() && start.getTime() <= w.lte.getTime()
    );

  it('matches the per-rule catch-up predicate for every hour of 45 days', () => {
    for (let hour = 0; hour <= 45 * 24; hour += 1) {
      const start = new Date(now.getTime() - hour * TIME.MS_PER_HOUR);
      const trialDay = calculateTrialDay(start, now);
      const due = triggerDays.some(day =>
        isTrialRuleWithinCatchupWindow(trialDay, day)
      );
      expect(inWindows(start)).toBe(due);
    }
  });

  it('merges touching ranges into one', () => {
    const merged = trialDueStartWindows([0, 3], now);
    expect(merged).toHaveLength(1);
    const span = EMAIL_LIFECYCLE_CONFIG.CATCHUP_WINDOW_DAYS + 1;
    expect(merged[0]?.gt.getTime()).toBe(now.getTime() - (3 + span) * DAY);
    expect(merged[0]?.lte.getTime()).toBe(now.getTime());
  });

  it('returns nothing for an empty schedule', () => {
    expect(trialDueStartWindows([], now)).toEqual([]);
  });
});
