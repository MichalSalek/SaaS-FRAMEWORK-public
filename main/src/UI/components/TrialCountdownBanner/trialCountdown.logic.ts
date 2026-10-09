// UI/components/TrialCountdownBanner/trialCountdown.logic.ts
// Pure date math + audience gate for the trial countdown banner (no React).

import { TIME } from '@kernel/application/constants.config';
import {
  SubscriptionStatusValue,
  type SubscriptionStatus,
} from '@kernel/models/db_models.generated.dto';

/** Okno urgency — DECISION o progu ≤7 dni w TrialCountdownBanner.molecule. */
export const TRIAL_URGENCY_WINDOW_DAYS = 7;

export type TrialUrgencyTier = 'mild' | 'urgent' | 'lastDay';

export type TrialTitleKey =
  'title7days' | 'title1day' | 'titleLastHours' | 'titleTomorrowAt';

export interface TrialCountdown {
  trialDate: Date;
  msRemaining: number;
  daysRemaining: number;
  tier: TrialUrgencyTier;
  /** Which copy to use; the `*At` / `LastHours` keys need the expiry time. */
  titleKey: TrialTitleKey;
}

/** Slice of `stylist_account` the banner reads. */
export interface TrialBannerAccount {
  trial_ends_at?: Date | string | null;
  subscription_status?: SubscriptionStatus | null;
  cancel_at_period_end?: boolean | null;
  cancel_at?: Date | string | null;
}

/**
 * The trial end date the banner may count down to, or `null` when it must not
 * show at all.
 *
 * DECISION (nie usuwaj tego komentarza): `trial_ends_at` is written once, when
 * the subscription first enters trialing, and is NEVER cleared. Gating on the
 * date alone kept the banner up after the trial stopped being a trial: a
 * stylist who cancelled during the trial read „a potem rusza subskrypcja,
 * chyba że anulujesz" (false, she already cancelled) and one who converted
 * early was told her trial was ending. The copy is only true for a subscription
 * that is still trialing AND will convert, so that is the gate.
 */
export function resolveTrialBannerEndsAt(
  account: TrialBannerAccount | null | undefined
): Date | string | null {
  if (account == null) {
    return null;
  }
  const willConvert =
    account.subscription_status === SubscriptionStatusValue.TRIALING &&
    account.cancel_at_period_end !== true &&
    account.cancel_at == null;
  return willConvert ? (account.trial_ends_at ?? null) : null;
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Countdown state for `trialEndsAt` at `nowMs`, or `null` outside the urgency
 * window (no date, unparsable date, already expired, more than 7 days away).
 */
export function resolveTrialCountdown(
  trialEndsAt: Date | string | null,
  nowMs: number
): TrialCountdown | null {
  if (trialEndsAt === null) {
    return null;
  }
  const trialDate =
    trialEndsAt instanceof Date ? trialEndsAt : new Date(trialEndsAt);
  if (isNaN(trialDate.getTime())) {
    return null;
  }
  const msRemaining = trialDate.getTime() - nowMs;
  const daysRemaining = Math.ceil(msRemaining / TIME.MS_PER_DAY);
  if (msRemaining <= 0 || daysRemaining > TRIAL_URGENCY_WINDOW_DAYS) {
    return null;
  }

  const hours = msRemaining / TIME.MS_PER_HOUR;
  let tier: TrialUrgencyTier = 'mild';
  if (hours < 24) {
    tier = 'lastDay';
  } else if (hours / 24 <= 3) {
    tier = 'urgent';
  }

  // Less than 24 hours left is not the same as "ends today": at 20:00 a trial
  // ending tomorrow at 10:00 has 14 hours left, and „kończy się dziś o 10:00"
  // named a time that had already passed today.
  let titleKey: TrialTitleKey;
  if (tier === 'lastDay') {
    titleKey = isSameLocalDay(trialDate, new Date(nowMs))
      ? 'titleLastHours'
      : 'titleTomorrowAt';
  } else if (daysRemaining <= 2) {
    titleKey = 'title1day';
  } else {
    titleKey = 'title7days';
  }

  return { trialDate, msRemaining, daysRemaining, tier, titleKey };
}
