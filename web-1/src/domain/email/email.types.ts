/**
 * Email Domain Types
 *
 * Types specific to the email domain layer.
 * Shared-kernel types (EmailCategory, TrialEmailRule, etc.) are imported from @kernel.
 */

import type { EmailCategory } from '@kernel/domain/email/email-schedule.config';
import {
  type EmailPreferences,
  DEFAULT_EMAIL_PREFERENCES,
} from '@kernel/models/email/email.dto';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import type {
  PaymentStatus,
  SubscriptionStatus,
} from '@kernel/models/db_models.generated.dto';
import type { EVENT_INFO_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';

/**
 * Safely parse a Prisma Json? field into EmailPreferences.
 * Validates shape — falls back to DEFAULT_EMAIL_PREFERENCES for malformed data.
 */
export const parseEmailPreferences = (raw: unknown): EmailPreferences => {
  if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (
      typeof obj.trial_sequence === 'boolean' &&
      typeof obj.marketing === 'boolean'
    ) {
      return {
        trial_sequence: obj.trial_sequence,
        marketing: obj.marketing,
      };
    }
  }
  return DEFAULT_EMAIL_PREFERENCES;
};

/**
 * StylistAccount with stats needed for email lifecycle decisions.
 * Matches Prisma select shape used in the sweep query.
 *
 * Note: User model has `name` and `email`, StylistAccount has `display_name`.
 * We use StylistAccount.display_name for personalization (it's the public name).
 */
export type StylistAccountWithStats = {
  account_id: string;
  trial_started_at: Date | null;
  trial_ends_at: Date | null;
  payment_status: PaymentStatus;
  // Trial audience (2026-09-23): in-trial nudges require TRIALING (trialing maps
  // to payment_status PAID; a null subscription_status is not a live trial after
  // SPE). D30/D37 use pricing_plan + status to exclude converted accounts.
  // See trial-audience.policy.ts.
  subscription_status: SubscriptionStatus | null;
  pricing_plan: PricingPlan;
  display_name: string | null;
  email_preferences: EmailPreferences | null;
  // DECISION (PRMA email_preferences Phase 2, 2026-05-27):
  // Reads z typed Boolean columns (email_marketing, email_trial_sequence).
  // JSON `email_preferences` zachowany jako shadow dla rollback safety.
  // Phase 3 (separate PR) — drop JSON column po zweryfikowaniu zero rollback need.
  email_marketing: boolean;
  email_trial_sequence: boolean;
  created_by_user_id: string;
  created_by_user: {
    is_active: boolean;
    email: string;
    name: string;
  };
  _count: {
    gallery_record: number;
  };
  // Paired clients count — from batch groupBy query
  stylist_pairings_count: number;
  /** Present on sweep rows that may mint or apply a first-month offer. */
  stripe_customer_id?: string | null;
  subscription_id?: string | null;
  cancel_at_period_end?: boolean | null;
};

/**
 * Parsed email history entry from EventLog.
 */
export type EmailHistoryEntry = {
  event_log_id: string;
  event: EVENT_INFO_TYPE;
  sentAt: string;
  category: EmailCategory | 'UNKNOWN';
};
