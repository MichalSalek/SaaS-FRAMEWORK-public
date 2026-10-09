// UI/features/account/AccountPayPage.helpers.ts
// Pure helpers for the pay page (split to keep the composition under its
// line cap).

import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import {
  SubscriptionStatusValue,
  type StylistAccount,
} from '@kernel/models/db_models.generated.dto';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';
import { formatDate } from '../../../application/date/date.utils';
import type { BillingCycle } from '../../components/BillingToggle/BillingToggle.molecule';

/** The two billing-cycle vocabularies: UI toggle ('monthly'|'yearly') vs the
 *  kernel checkout contract ('month'|'year'). Bridge once, here. */
export const toBillingPeriod = (cycle: BillingCycle): BillingPeriod =>
  cycle === 'yearly' ? 'year' : 'month';

type BillingHintKey =
  'billingHint' | 'promoMonthlyApplied' | 'promoMonthlyOnly';

/**
 * The hint under the billing toggle. A code from a lifecycle e-mail is a
 * one-month discount, honoured only for monthly billing (the backend ignores
 * it on a yearly price, DECISION in checkout-discount.operations.ts), so the
 * hint says so instead of letting the price silently jump to the full year.
 */
export const payBillingHintKey = (
  promo: string | undefined,
  cycle: BillingCycle
): BillingHintKey => {
  if (promo === undefined) {
    return 'billingHint';
  }
  return cycle === 'monthly' ? 'promoMonthlyApplied' : 'promoMonthlyOnly';
};

/* ─── Current-plan status summary ─── */

type StatusFields = Pick<
  StylistAccount,
  | 'pricing_plan'
  | 'subscription_status'
  | 'cancel_at_period_end'
  | 'cancel_at'
  | 'current_period_end'
  | 'trial_ends_at'
>;

/** Wire value is an ISO string at runtime (typed Date by the kernel). */
type StatusDate = NonNullable<StylistAccount['trial_ends_at']>;

export type PlanStatusSummary =
  | { kind: 'free' }
  | { kind: 'active' }
  | { kind: 'pastDue' }
  | { kind: 'trialing'; until: StatusDate }
  | { kind: 'canceling'; until: StatusDate };

/**
 * What the current-plan card may truthfully say, derived from the Stripe
 * mirror fields the account already carries (webhook-written). Before, a paid
 * plan always read "Plan aktywny / subskrypcja aktywna", also during a trial,
 * after a scheduled cancellation and with a failed renewal payment.
 * Precedence: a failed payment needs action first; a scheduled cancellation
 * beats the trial (a trial cancelled mid-way ends, it does not convert).
 * A state whose date is missing falls through to the next rule, so the copy
 * never interpolates an empty date.
 */
export const resolvePlanStatusSummary = (
  account: StatusFields
): PlanStatusSummary => {
  if (account.pricing_plan === PricingPlanValue.FREE) {
    return { kind: 'free' };
  }
  const status = account.subscription_status;
  // INCOMPLETE = the first payment never completed (e.g. an abandoned 3DS
  // step) while the plan is still the paid one: not an active subscription.
  if (
    status === SubscriptionStatusValue.PAST_DUE ||
    status === SubscriptionStatusValue.UNPAID ||
    status === SubscriptionStatusValue.INCOMPLETE
  ) {
    return { kind: 'pastDue' };
  }
  const cancelUntil = account.cancel_at ?? account.current_period_end;
  if (
    (account.cancel_at_period_end === true || account.cancel_at !== null) &&
    cancelUntil !== null
  ) {
    return { kind: 'canceling', until: cancelUntil };
  }
  if (
    status === SubscriptionStatusValue.TRIALING &&
    account.trial_ends_at !== null
  ) {
    return { kind: 'trialing', until: account.trial_ends_at };
  }
  return { kind: 'active' };
};

/**
 * `account.pay` keys per status. A paid plan fills the billing card under the
 * intro (`title` + `body`, dated titles interpolate `{date}`); Free has no
 * subscription to manage, so it only feeds the intro line (`heroMeta`).
 */
type PlanStatusCopyKeys =
  | { heroMeta: string; title: null; body: null }
  | { heroMeta: null; title: string; body: string };

const planStatusCopyKeys = (
  kind: PlanStatusSummary['kind'],
  hasRenewalDate = false
): PlanStatusCopyKeys => {
  switch (kind) {
    case 'free':
      return { heroMeta: 'heroMetaFree', title: null, body: null };
    case 'active':
      return {
        heroMeta: null,
        title: hasRenewalDate ? 'billingTitleRenews' : 'billingTitleActive',
        body: 'billingBodyActive',
      };
    case 'trialing':
      return {
        heroMeta: null,
        title: 'billingTitleTrialing',
        body: 'billingBodyTrialing',
      };
    case 'canceling':
      return {
        heroMeta: null,
        title: 'billingTitleCanceling',
        body: 'billingBodyCanceling',
      };
    case 'pastDue':
      return {
        heroMeta: null,
        title: 'billingTitlePastDue',
        body: 'billingBodyPastDue',
      };
  }
};

/**
 * Keys + formatted date for the intro and the billing card (`account.pay`).
 * An active subscription shows its next payment date only while the mirrored
 * period end is still ahead: a stale mirror must never print a past date as
 * "next payment".
 */
export const resolvePlanStatusCopy = (
  account: StatusFields | null,
  locale: string,
  now: number = Date.now()
): {
  kind: PlanStatusSummary['kind'];
  keys: PlanStatusCopyKeys;
  date: string;
} => {
  const summary: PlanStatusSummary = account
    ? resolvePlanStatusSummary(account)
    : { kind: 'free' };
  if ('until' in summary) {
    return {
      kind: summary.kind,
      keys: planStatusCopyKeys(summary.kind),
      date: formatDate(summary.until, locale),
    };
  }
  const periodEnd = account?.current_period_end ?? null;
  const renews =
    summary.kind === 'active' &&
    periodEnd !== null &&
    new Date(periodEnd).getTime() > now;
  return {
    kind: summary.kind,
    keys: planStatusCopyKeys(summary.kind, renews),
    date: renews ? formatDate(periodEnd, locale) : '',
  };
};

/* ─── The one filled action of the plan list ─── */

interface RecommendablePlan {
  id: string;
  isPopular?: boolean;
  isCustom?: boolean;
}

/**
 * Which plan card carries the screen's filled button: the popular plan when it
 * is an upgrade, otherwise the nearest purchasable upgrade. `null` = no card is
 * filled (top tier, or a failed payment: fixing billing comes first), and the
 * billing button takes the fill instead.
 */
export const resolveRecommendedPlanId = <P extends RecommendablePlan>(
  plans: readonly P[],
  currentIndex: number,
  kind: PlanStatusSummary['kind']
): P['id'] | null => {
  if (kind === 'pastDue') {
    return null;
  }
  const upgrades = plans
    .slice(currentIndex + 1)
    .filter(plan => plan.isCustom !== true);
  const popular = upgrades.find(plan => plan.isPopular === true);
  return (popular ?? upgrades[0])?.id ?? null;
};

/** The custom plan's „Kontakt”: opens the mail client. */
export const openContactMail = (): void => {
  if (typeof window !== 'undefined') {
    // location.assign() (method call) instead of `location.href = ...`
    // (external write) — identical mailto navigation, but the React Compiler
    // does not flag it as "writing to a variable defined outside a component".
    window.location.assign(`mailto:${BRAND_CONFIG.email.contact}`);
  }
};
