/**
 * Cancel-sequence audience. Pure: the sender supplies the latest plan-change
 * event and the account snapshot. Day 0 is that event's created_at, because
 * Stripe clears cancel_at and current_period_end on subscription.deleted.
 */

import { TIME } from '@kernel/application/constants.config';
import {
  EMAIL_CATEGORY,
  EMAIL_LIFECYCLE_CONFIG,
  POST_TRIAL_AUDIENCE_WINDOW_DAYS,
  type EmailCategory,
} from '@kernel/domain/email/email-schedule.config';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { SubscriptionStatusValue } from '@kernel/models/db_models.generated.dto';
import { isTrialRuleWithinCatchupWindow } from '@domain/email/trial-audience.policy';

export type CancelAudienceSnapshot = {
  userActive: boolean;
  subscriptionStatus: string | null;
  pricingPlan: string;
  trialEndsAt: Date | null;
};

export const isCancelSequenceAudience = (
  account: CancelAudienceSnapshot
): boolean =>
  account.userActive &&
  account.subscriptionStatus === SubscriptionStatusValue.CANCELED &&
  account.pricingPlan === PricingPlanValue.FREE;

/**
 * A trial that ended inside the post-trial window is still the trial
 * sequence's audience (D30 / D37). The cancel sequence stays quiet.
 */
export const isExcludedByPostTrialWindow = (
  trialEndsAt: Date | null,
  now: Date
): boolean => {
  if (!trialEndsAt) {
    return false;
  }
  const ageMs = now.getTime() - trialEndsAt.getTime();
  if (ageMs < 0) {
    return false;
  }
  return ageMs <= POST_TRIAL_AUDIENCE_WINDOW_DAYS * TIME.MS_PER_DAY;
};

export const calculateCancelDay = (canceledAt: Date, now: Date): number =>
  Math.floor((now.getTime() - canceledAt.getTime()) / TIME.MS_PER_DAY);

export const isCancelRuleDue = (
  cancelDay: number,
  triggerDay: number
): boolean => isTrialRuleWithinCatchupWindow(cancelDay, triggerDay);

/**
 * How far back a cancellation can be and still have a rule inside its
 * catch-up window. Older anchors cannot be mailed, so the sweep does not read
 * them.
 */
export const cancelAnchorLookbackDays = (
  triggerDays: readonly number[]
): number =>
  Math.max(0, ...triggerDays) + EMAIL_LIFECYCLE_CONFIG.CATCHUP_WINDOW_DAYS + 1;

/** Rules due on this cancel day that have not been sent yet. */
export const pendingCancelRules = <
  R extends { readonly triggerDay: number; readonly infoEvent: string },
>(
  rules: readonly R[],
  cancelDay: number,
  sentEvents: ReadonlySet<string>
): R[] =>
  rules.filter(
    rule =>
      isCancelRuleDue(cancelDay, rule.triggerDay) &&
      !sentEvents.has(rule.infoEvent)
  );

/**
 * Rules this account may get now: due, not sent yet, and a MARKETING rule only
 * with marketing consent. The weekly frequency cap is applied later, at send
 * time. Shared by the sweep and the admin queue preview.
 */
export const eligibleCancelRules = <
  R extends {
    readonly triggerDay: number;
    readonly infoEvent: string;
    readonly category: EmailCategory;
  },
>(
  rules: readonly R[],
  cancelDay: number,
  sentEvents: ReadonlySet<string>,
  emailMarketing: boolean | null
): R[] =>
  pendingCancelRules(rules, cancelDay, sentEvents).filter(
    rule =>
      rule.category !== EMAIL_CATEGORY.MARKETING || emailMarketing === true
  );
