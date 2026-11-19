import { PricingPlanValue } from '../pricing/pricing.config';
import type { SafeStylistAccount } from '../../models/session/session.dto';

export type SubscriptionState =
  'free' | 'trialing' | 'active' | 'canceling' | 'past_due';

type SubscriptionMirror = {
  pricing_plan: SafeStylistAccount['pricing_plan'];
  subscription_status: SafeStylistAccount['subscription_status'];
  cancel_at_period_end: SafeStylistAccount['cancel_at_period_end'];
  // Presence only. The row stores a Date; the session response stores an ISO string.
  cancel_at: unknown;
};

export function resolveSubscriptionState(
  account: SubscriptionMirror
): SubscriptionState {
  if (
    account.pricing_plan === PricingPlanValue.FREE ||
    account.subscription_status === 'CANCELED' ||
    account.subscription_status === 'INCOMPLETE_EXPIRED' ||
    account.subscription_status === 'PAUSED'
  ) {
    return 'free';
  }
  if (
    account.subscription_status === 'PAST_DUE' ||
    account.subscription_status === 'UNPAID' ||
    account.subscription_status === 'INCOMPLETE'
  ) {
    return 'past_due';
  }
  if (account.cancel_at_period_end || account.cancel_at != null) {
    return 'canceling';
  }
  if (account.subscription_status === 'TRIALING') {
    return 'trialing';
  }
  return 'active';
}

/** Capability source and billing state are separate: the member never inherits billing. */
export function resolveEffectiveSubscriptionState(
  account: Parameters<typeof resolveSubscriptionState>[0] &
    Pick<SafeStylistAccount, 'salon_plan'>
): SubscriptionState | 'salon_member' {
  return account.salon_plan
    ? 'salon_member'
    : resolveSubscriptionState(account);
}
