/**
 * Email Personalization Resolver
 *
 * SRP: Map PersonalizationField[] from a TrialEmailRule to concrete string values.
 * Pure domain logic — no I/O. Offer codes are passed in by the sender after
 * Stripe accepts them; this module only formats them.
 */

import type {
  PersonalizationField,
  TrialEmailRule,
} from '@kernel/domain/email/email-schedule.types';
import { TIME } from '@kernel/application/constants.config';
import { TRIAL_CONFIG } from '@kernel/domain/stripe/stripe.config';
import {
  getPlanDisplayName,
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import type { LocaleType } from '@kernel/domain/i18n/i18n.config';
import type { StylistAccountWithStats } from '@domain/email/email.types';
import { formatEmailDate, formatEmailDateTime } from './email-date.format';

export type PersonalizationExtras = {
  locale?: LocaleType;
  offerCode?: string;
  offerExpiresAt?: Date | null;
  /** Paid plan the trial was on, when the account is already FREE. */
  endedTrialPlan?: PricingPlan | null;
};

const PAID_PLANS: readonly PricingPlan[] = [
  PricingPlanValue.PRO,
  PricingPlanValue.PRO_PLUS,
  PricingPlanValue.STUDIO,
];

/**
 * The plan named in trial copy. A live trial still carries its paid
 * pricing_plan. After a non-conversion the column is FREE, so the name comes
 * from the plan-change event (endedTrialPlan). PRO is the last resort: it is
 * the trial-forward default, not a hardcoded label for every account.
 */
export const resolveNamedPlan = (
  account: Pick<StylistAccountWithStats, 'pricing_plan'>,
  extras: PersonalizationExtras
): PricingPlan => {
  if (account.pricing_plan !== PricingPlanValue.FREE) {
    return account.pricing_plan;
  }
  if (extras.endedTrialPlan && PAID_PLANS.includes(extras.endedTrialPlan)) {
    return extras.endedTrialPlan;
  }
  return PricingPlanValue.PRO;
};

const trialEnd = (account: StylistAccountWithStats): Date | null => {
  if (account.trial_ends_at) {
    return account.trial_ends_at;
  }
  if (account.trial_started_at) {
    return new Date(
      account.trial_started_at.getTime() +
        TRIAL_CONFIG.DURATION_DAYS * TIME.MS_PER_DAY
    );
  }
  return null;
};

const resolveField = (
  field: PersonalizationField,
  account: StylistAccountWithStats,
  extras: PersonalizationExtras
): string => {
  const locale = extras.locale ?? 'pl';
  switch (field) {
    case 'displayName':
      return account.display_name || account.created_by_user.name || '';

    case 'galleryCount':
      return String(account._count.gallery_record);

    case 'pairedClientsCount':
      return String(account.stylist_pairings_count);

    case 'trialDaysLeft': {
      const end = trialEnd(account);
      if (!end) {
        return String(TRIAL_CONFIG.DURATION_DAYS);
      }
      const msLeft = end.getTime() - Date.now();
      return String(Math.max(0, Math.ceil(msLeft / TIME.MS_PER_DAY)));
    }

    case 'trialEndDate': {
      const end = trialEnd(account);
      return end ? formatEmailDate(end, locale) : '';
    }

    case 'planName':
      return getPlanDisplayName(resolveNamedPlan(account, extras));

    case 'funnelPlanId':
      return resolveNamedPlan(account, extras);

    case 'offerCode':
      return extras.offerCode ?? '';

    case 'offerExpiresAt':
      return extras.offerExpiresAt
        ? formatEmailDateTime(extras.offerExpiresAt, locale)
        : '';

    case 'renewalAmount':
      return '';

    case 'renewalDate':
      return '';

    default: {
      const _exhaustive: never = field;
      void _exhaustive;
      return '';
    }
  }
};

export const resolvePersonalization = (
  account: StylistAccountWithStats,
  rule: Pick<TrialEmailRule, 'personalizeWith'>,
  extras: PersonalizationExtras = {}
): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const field of rule.personalizeWith) {
    result[field] = resolveField(field, account, extras);
  }
  return result;
};
