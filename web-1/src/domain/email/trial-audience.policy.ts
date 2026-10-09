/**
 * Trial-email audience predicates.
 *
 * Pure: no I/O. The sweep query in trial-emails.operation.ts mirrors
 * `NON_CONVERTED_*` and `isInActiveStripeTrial`; `resolveTrialEmails` applies
 * the same predicates per rule so a row the query over-includes still cannot
 * be mailed.
 *
 * Snapshot, not history. There is no converted_at column, and
 * customer.subscription.deleted nulls cancel_at and current_period_end, so
 * "converted" means the account is ACTIVE + PAID on a non-FREE plan right now.
 * Canceled, dropped to FREE, or payment-failed (PAST_DUE/UNPAID → IN_PROGRESS)
 * is the post-trial audience. A still-TRIALING row whose trial_ends_at has
 * passed is neither: the conversion webhook has not landed, and mailing
 * "trial ended" in that gap would hit accounts that are about to convert.
 */

import { EMAIL_LIFECYCLE_CONFIG } from '@kernel/domain/email/email-schedule.config';
import type { TrialEmailRule } from '@kernel/domain/email/email-schedule.types';
import { TIME } from '@kernel/application/constants.config';
import { TRIAL_CONFIG } from '@kernel/domain/stripe/stripe.config';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import {
  PaymentStatusValue,
  SubscriptionStatusValue,
  type PaymentStatus,
  type SubscriptionStatus,
} from '@kernel/models/db_models.generated.dto';

export type TrialConversionSnapshot = {
  readonly subscription_status: SubscriptionStatus | null;
  readonly payment_status: PaymentStatus;
  readonly pricing_plan: PricingPlan;
};

/**
 * Subscription statuses that mean the trial did not convert: canceled (and
 * the other terminal non-paying statuses) or a failed charge (PAST_DUE/UNPAID,
 * which mapStripeStatusToPaymentStatus stores as IN_PROGRESS).
 * TRIALING is deliberately absent.
 */
export const NON_CONVERTED_SUBSCRIPTION_STATUSES = [
  SubscriptionStatusValue.CANCELED,
  SubscriptionStatusValue.INCOMPLETE,
  SubscriptionStatusValue.INCOMPLETE_EXPIRED,
  SubscriptionStatusValue.PAUSED,
  SubscriptionStatusValue.PAST_DUE,
  SubscriptionStatusValue.UNPAID,
] as const satisfies readonly SubscriptionStatus[];

/** Payment statuses that mean the charge failed or never landed. PAID is absent. */
export const NON_CONVERTED_PAYMENT_STATUSES = [
  PaymentStatusValue.UNPAID,
  PaymentStatusValue.IN_PROGRESS,
  PaymentStatusValue.REJECTED,
] as const satisfies readonly PaymentStatus[];

const nonConvertedSubscriptionStatuses: readonly SubscriptionStatus[] =
  NON_CONVERTED_SUBSCRIPTION_STATUSES;
const nonConvertedPaymentStatuses: readonly PaymentStatus[] =
  NON_CONVERTED_PAYMENT_STATUSES;

/**
 * In-trial nudges (triggerDay < trial length). D30/D37 are post-trial; their
 * copy describes an account on Free, so resolveTrialEmails also requires
 * pricing_plan FREE on top of isNonConvertedAfterTrial.
 */
export const isPostTrialEmailRule = (rule: TrialEmailRule): boolean =>
  rule.triggerDay >= TRIAL_CONFIG.DURATION_DAYS;

/** Stripe trial still open: dates in the future and status trialing. */
export const isInActiveStripeTrial = (
  account: {
    readonly trial_ends_at: Date | null;
    readonly subscription_status: SubscriptionStatus | null;
  },
  now: Date
): boolean =>
  account.trial_ends_at !== null &&
  account.trial_ends_at.getTime() > now.getTime() &&
  account.subscription_status === SubscriptionStatusValue.TRIALING;

/**
 * Converted after the trial clock: subscription active, payment PAID, plan
 * not FREE. TRIALING maps to PAID too, but TRIALING is not ACTIVE, so an
 * in-progress trial is not "converted".
 */
export const isTrialConverted = (account: TrialConversionSnapshot): boolean =>
  account.subscription_status === SubscriptionStatusValue.ACTIVE &&
  account.payment_status === PaymentStatusValue.PAID &&
  account.pricing_plan !== PricingPlanValue.FREE;

/**
 * D30/D37 recipients: did not convert. FREE plan, a terminal/failed
 * subscription status, or a failed payment. Still-TRIALING returns false.
 */
export const isNonConvertedAfterTrial = (
  account: TrialConversionSnapshot
): boolean => {
  if (isTrialConverted(account)) {
    return false;
  }
  if (account.pricing_plan === PricingPlanValue.FREE) {
    return true;
  }
  if (
    account.subscription_status !== null &&
    nonConvertedSubscriptionStatuses.includes(account.subscription_status)
  ) {
    return true;
  }
  return nonConvertedPaymentStatuses.includes(account.payment_status);
};

/**
 * True when the rule's trigger day has arrived and is not older than
 * EMAIL_LIFECYCLE_CONFIG.CATCHUP_WINDOW_DAYS. Older rules are skipped
 * (not sent, not logged).
 */
export const isTrialRuleWithinCatchupWindow = (
  trialDay: number,
  triggerDay: number
): boolean =>
  triggerDay <= trialDay &&
  trialDay - triggerDay <= EMAIL_LIFECYCLE_CONFIG.CATCHUP_WINDOW_DAYS;

/** A half-open range of trial start times: `gt` < trial_started_at <= `lte`. */
export type TrialStartWindow = { readonly gt: Date; readonly lte: Date };

/**
 * The trial_started_at ranges in which at least one rule is inside its
 * catch-up window right now: trialDay in [triggerDay, triggerDay + CATCHUP].
 * Since trialDay = floor((now - start) / day), that is a start in
 * (now - (triggerDay + CATCHUP + 1) days, now - triggerDay days]. Overlapping
 * ranges are merged. The sweep query filters on these, so accounts between
 * windows (nothing can be sent to them) never take a page slot.
 */
export const trialDueStartWindows = (
  triggerDays: readonly number[],
  now: Date
): TrialStartWindow[] => {
  const span = EMAIL_LIFECYCLE_CONFIG.CATCHUP_WINDOW_DAYS + 1;
  const ranges = [...new Set(triggerDays)]
    .sort((a, b) => a - b)
    .map(day => ({ fromDay: day, toDay: day + span }));
  const merged: Array<{ fromDay: number; toDay: number }> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last !== undefined && range.fromDay <= last.toDay) {
      last.toDay = Math.max(last.toDay, range.toDay);
    } else {
      merged.push({ ...range });
    }
  }
  return merged.map(({ fromDay, toDay }) => ({
    gt: new Date(now.getTime() - toDay * TIME.MS_PER_DAY),
    lte: new Date(now.getTime() - fromDay * TIME.MS_PER_DAY),
  }));
};
