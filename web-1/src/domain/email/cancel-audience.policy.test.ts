import { describe, expect, it } from 'vitest';
import { TIME } from '@kernel/application/constants.config';
import {
  CANCEL_EMAIL_SCHEDULE,
  EMAIL_LIFECYCLE_CONFIG,
  POST_TRIAL_AUDIENCE_WINDOW_DAYS,
} from '@kernel/domain/email/email-schedule.config';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { SubscriptionStatusValue } from '@kernel/models/db_models.generated.dto';
import {
  calculateCancelDay,
  cancelAnchorLookbackDays,
  eligibleCancelRules,
  isCancelRuleDue,
  pendingCancelRules,
  isCancelSequenceAudience,
  isExcludedByPostTrialWindow,
} from './cancel-audience.policy';

const now = new Date('2026-09-23T12:00:00.000Z');

describe('isCancelSequenceAudience', () => {
  it('accepts an active user on FREE with a canceled subscription', () => {
    expect(
      isCancelSequenceAudience({
        userActive: true,
        subscriptionStatus: SubscriptionStatusValue.CANCELED,
        pricingPlan: PricingPlanValue.FREE,
        trialEndsAt: null,
      })
    ).toBe(true);
  });

  it('rejects a live trial, a paid plan, and a disabled user', () => {
    expect(
      isCancelSequenceAudience({
        userActive: true,
        subscriptionStatus: SubscriptionStatusValue.TRIALING,
        pricingPlan: PricingPlanValue.FREE,
        trialEndsAt: null,
      })
    ).toBe(false);
    expect(
      isCancelSequenceAudience({
        userActive: true,
        subscriptionStatus: SubscriptionStatusValue.CANCELED,
        pricingPlan: PricingPlanValue.PRO,
        trialEndsAt: null,
      })
    ).toBe(false);
    expect(
      isCancelSequenceAudience({
        userActive: false,
        subscriptionStatus: SubscriptionStatusValue.CANCELED,
        pricingPlan: PricingPlanValue.FREE,
        trialEndsAt: null,
      })
    ).toBe(false);
  });
});

describe('isExcludedByPostTrialWindow', () => {
  it('excludes a trial that ended inside the post-trial window', () => {
    const trialEndsAt = new Date(
      now.getTime() - (POST_TRIAL_AUDIENCE_WINDOW_DAYS - 1) * TIME.MS_PER_DAY
    );
    expect(isExcludedByPostTrialWindow(trialEndsAt, now)).toBe(true);
  });

  it('keeps an account whose trial ended before that window, or never started', () => {
    const older = new Date(
      now.getTime() - (POST_TRIAL_AUDIENCE_WINDOW_DAYS + 1) * TIME.MS_PER_DAY
    );
    expect(isExcludedByPostTrialWindow(older, now)).toBe(false);
    expect(isExcludedByPostTrialWindow(null, now)).toBe(false);
  });
});

describe('isCancelRuleDue', () => {
  it('uses the same catch-up window as the trial rules', () => {
    const canceledAt = new Date(now.getTime() - 7 * TIME.MS_PER_DAY);
    expect(calculateCancelDay(canceledAt, now)).toBe(7);
    expect(isCancelRuleDue(7, 7)).toBe(true);
    expect(isCancelRuleDue(9, 7)).toBe(true);
    expect(isCancelRuleDue(10, 7)).toBe(false);
    expect(isCancelRuleDue(6, 7)).toBe(false);
  });
});

describe('cancelAnchorLookbackDays', () => {
  it('covers the last day of the latest rule catch-up window', () => {
    const triggerDays = CANCEL_EMAIL_SCHEDULE.map(rule => rule.triggerDay);
    const lookback = cancelAnchorLookbackDays(triggerDays);
    const latest = Math.max(...triggerDays);
    const lastDueDay = latest + EMAIL_LIFECYCLE_CONFIG.CATCHUP_WINDOW_DAYS;
    expect(isCancelRuleDue(lastDueDay, latest)).toBe(true);
    // lastDueDay runs until the next day boundary, so the lookback must reach
    // one full day past it.
    expect(lookback).toBe(lastDueDay + 1);
  });
});

describe('pendingCancelRules', () => {
  const d7 = CANCEL_EMAIL_SCHEDULE.find(rule => rule.triggerDay === 7);

  it('returns the rule due today when it was not sent', () => {
    expect(pendingCancelRules(CANCEL_EMAIL_SCHEDULE, 7, new Set())).toEqual(
      d7 ? [d7] : []
    );
  });

  it('drops a due rule that was already sent', () => {
    expect(
      pendingCancelRules(
        CANCEL_EMAIL_SCHEDULE,
        7,
        new Set(d7 ? [d7.infoEvent] : [])
      )
    ).toEqual([]);
  });

  it('returns nothing between windows', () => {
    expect(pendingCancelRules(CANCEL_EMAIL_SCHEDULE, 20, new Set())).toEqual(
      []
    );
  });
});

describe('eligibleCancelRules', () => {
  const d7 = CANCEL_EMAIL_SCHEDULE.find(rule => rule.triggerDay === 7);
  const d1 = CANCEL_EMAIL_SCHEDULE.find(rule => rule.triggerDay === 1);

  it('keeps a due marketing rule only with marketing consent', () => {
    expect(
      eligibleCancelRules(CANCEL_EMAIL_SCHEDULE, 7, new Set(), true).map(
        rule => rule.id
      )
    ).toEqual(d7 ? [d7.id] : []);
    expect(
      eligibleCancelRules(CANCEL_EMAIL_SCHEDULE, 7, new Set(), false)
    ).toEqual([]);
  });

  it('keeps the transactional D1 mail without marketing consent', () => {
    expect(
      eligibleCancelRules(CANCEL_EMAIL_SCHEDULE, 1, new Set(), false).map(
        rule => rule.id
      )
    ).toEqual(d1 ? [d1.id] : []);
  });

  it('drops a rule that was already sent', () => {
    expect(
      eligibleCancelRules(
        CANCEL_EMAIL_SCHEDULE,
        1,
        new Set(d1 ? [d1.infoEvent] : []),
        true
      )
    ).toEqual([]);
  });
});
