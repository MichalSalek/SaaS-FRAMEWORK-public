/**
 * Trial Email Resolver (domain/email)
 *
 * SRP: For a given StylistAccount + stats, determine which trial emails should be sent.
 * Pure domain logic — no I/O, no side effects.
 *
 * Moved from application/email-handler/lifecycle/email-schedule.resolver.ts (FWE Wave E):
 * pure-domain trial scheduling logic belongs in domain/, not the generic email scaffolding.
 */

import {
  ACTIVATION_THRESHOLD,
  EMAIL_CATEGORY,
  TRIAL_EMAIL_SCHEDULE,
  type EmailCategory,
} from '@kernel/domain/email/email-schedule.config';
import type { TrialEmailRule } from '@kernel/domain/email/email-schedule.types';
import {
  type EmailPreferences,
  DEFAULT_EMAIL_PREFERENCES,
} from '@kernel/models/email/email.dto';
import { SubscriptionStatusValue } from '@kernel/models/db_models.generated.dto';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import type { EVENT_INFO_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
import { TIME } from '@kernel/application/constants.config';
import type { StylistAccountWithStats } from '@domain/email/email.types';
import {
  isInActiveStripeTrial,
  isNonConvertedAfterTrial,
  isPostTrialEmailRule,
  isTrialRuleWithinCatchupWindow,
} from '@domain/email/trial-audience.policy';

const MS_PER_DAY = TIME.MS_PER_DAY;

/**
 * Calculate trial day (0-indexed) from trial_started_at.
 */
export const calculateTrialDay = (
  trialStartedAt: Date,
  now: Date = new Date()
): number =>
  Math.floor((now.getTime() - trialStartedAt.getTime()) / MS_PER_DAY);

/** In-trial nudges still refuse dunning and already-canceled subscribers. */
const IN_TRIAL_NUDGE_EXCLUDED = new Set<
  StylistAccountWithStats['subscription_status']
>([
  SubscriptionStatusValue.PAST_DUE,
  SubscriptionStatusValue.UNPAID,
  SubscriptionStatusValue.CANCELED,
]);

/**
 * DECISION (nie usuwaj tego komentarza, 2026-09-23):
 * D23 and D29 tell the reader that the trial turns into the paid plan on her
 * card. A trial canceled mid-way (cancel_at_period_end) stays TRIALING until
 * trial_ends_at, so without this set she would read a renewal promise that
 * Stripe will not keep. She gets D30/D37 after the trial instead.
 */
const RENEWAL_PROMISE_TEMPLATES = new Set<string>([
  'trial-warning',
  'trial-last-day',
]);

/**
 * Check if account meets activation threshold (3 photos + 1 QR).
 * For QR: we approximate via gallery_record count since QR generation
 * is tracked separately. In V1, we check gallery_record >= MIN_GALLERY_RECORDS
 * as the primary activation signal.
 *
 * NOTE: qrGeneratedCount is not available on the StylistAccount model directly.
 * For V1, activation is determined solely by gallery record count >= threshold.
 * QR check will be added when EventLog aggregation for QR events is implemented.
 */
const isActivated = (account: StylistAccountWithStats): boolean =>
  account._count.gallery_record >= ACTIVATION_THRESHOLD.MIN_GALLERY_RECORDS;

/**
 * Check if account is inactive (below activation threshold).
 * Covers: zero uploads AND partially-engaged users (1-2 photos).
 */
const isInactive = (account: StylistAccountWithStats): boolean =>
  account._count.gallery_record < ACTIVATION_THRESHOLD.MIN_GALLERY_RECORDS;

/**
 * Check if a condition matches the account state.
 *
 * INACTIVE: Early days (D1, D3) = no uploads at all.
 * ACTIVE: Later days (D7, D14) = meets activation threshold (3+ photos).
 * ANY: Always matches.
 */
const matchesCondition = (
  condition: 'ACTIVE' | 'INACTIVE' | 'ANY',
  account: StylistAccountWithStats
): boolean => {
  switch (condition) {
    case 'ANY':
      return true;
    case 'INACTIVE':
      return isInactive(account);
    case 'ACTIVE':
      return isActivated(account);
    default: {
      const _exhaustive: never = condition;
      void _exhaustive;
      return false;
    }
  }
};

/**
 * Check if account has opted out of this email category.
 * TRANSACTIONAL emails cannot be unsubscribed (PKE compliance).
 */
const isOptedOut = (
  category: EmailCategory,
  preferences: EmailPreferences
): boolean => {
  switch (category) {
    case EMAIL_CATEGORY.TRANSACTIONAL:
      return false;
    case EMAIL_CATEGORY.TRIAL_SEQUENCE:
      return preferences.trial_sequence === false;
    case EMAIL_CATEGORY.MARKETING:
      return preferences.marketing === false;
    default: {
      const _exhaustive: never = category;
      void _exhaustive;
      return false;
    }
  }
};

/**
 * Resolve which trial emails should be sent for a given account.
 *
 * @param account - StylistAccount with stats
 * @param sentEvents - Set of INFO event names already sent for this user
 * @param preferences - User's email preferences (null = default: all enabled)
 * @returns List of TrialEmailRule entries to send
 */
export const resolveTrialEmails = (
  account: StylistAccountWithStats,
  sentEvents: Set<EVENT_INFO_TYPE>,
  preferences: EmailPreferences | null,
  now: Date = new Date()
): readonly TrialEmailRule[] => {
  // Skip if no trial date
  if (!account.trial_started_at) {
    return [];
  }

  // Skip if user disabled/deleted
  if (!account.created_by_user.is_active) {
    return [];
  }

  // DECISION (nie usuwaj tego komentarza, 2026-09-23):
  // Trial Stripe z wymaganą kartą mapuje trialing → payment_status PAID
  // (mapStripeStatusToPaymentStatus). Dawny guard „PAID → []" wycinał każdy żywy
  // trial; pre-lock z subscription_status=null nie istnieje od SPE (daty trialu
  // pisze webhook razem ze statusem TRIALING). PAID+TRIALING jest publicznością
  // maili in-trial. Te maile nadal wykluczają PAST_DUE/UNPAID/CANCELED.
  // D30/D37 idą tylko do nieskonwertowanych po trial_ends_at
  // (isNonConvertedAfterTrial). Reguła starsza niż CATCHUP_WINDOW_DAYS jest
  // pomijana (nie wysłana, nie logowana).
  const trialDay = calculateTrialDay(account.trial_started_at, now);
  const prefs = preferences ?? DEFAULT_EMAIL_PREFERENCES;
  const trialHasEnded =
    account.trial_ends_at !== null &&
    account.trial_ends_at.getTime() <= now.getTime();

  return TRIAL_EMAIL_SCHEDULE.filter(rule => {
    if (!isTrialRuleWithinCatchupWindow(trialDay, rule.triggerDay)) {
      return false;
    }

    if (sentEvents.has(rule.infoEvent)) {
      return false;
    }

    if (isOptedOut(rule.category, prefs)) {
      return false;
    }

    if (!matchesCondition(rule.condition, account)) {
      return false;
    }

    // DECISION (nie usuwaj tego komentarza, 2026-09-23):
    // D30/D37 copy says the account is on Free now. A failed conversion charge
    // (PAST_DUE/UNPAID) keeps the paid plan while dunning runs, and dunning owns
    // that conversation ("update the card"); telling the same person "you are on
    // Free" and offering a fresh checkout on top of a live subscription is false
    // and risky. Such an account reaches Free only after the dunning downgrade,
    // which is past the catch-up window, so it gets downgrade-notification instead.
    if (isPostTrialEmailRule(rule)) {
      return (
        trialHasEnded &&
        isNonConvertedAfterTrial(account) &&
        account.pricing_plan === PricingPlanValue.FREE
      );
    }

    if (!isInActiveStripeTrial(account, now)) {
      return false;
    }
    if (IN_TRIAL_NUDGE_EXCLUDED.has(account.subscription_status)) {
      return false;
    }
    if (
      account.cancel_at_period_end === true &&
      RENEWAL_PROMISE_TEMPLATES.has(rule.bodyTemplateId)
    ) {
      return false;
    }

    return true;
  });
};
