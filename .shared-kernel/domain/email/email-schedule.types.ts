// Rule shapes for the email schedules in email-schedule.config.ts. Split out of
// that file (max-lines): the config holds the schedules, this file their types.
import type { EVENT_INFO_TYPE } from '../commands-and-queries/cqrs.types';
import type { EmailCategory } from './email-schedule.config';

export type PersonalizationField =
  | 'displayName'
  | 'galleryCount'
  | 'pairedClientsCount'
  | 'trialDaysLeft'
  | 'trialEndDate'
  | 'planName'
  | 'funnelPlanId'
  | 'offerCode'
  | 'offerExpiresAt'
  | 'renewalAmount'
  | 'renewalDate';

export type TrialEmailRule = {
  readonly id: string;
  readonly triggerDay: number;
  readonly condition: 'ACTIVE' | 'INACTIVE' | 'ANY';
  readonly category: EmailCategory;
  readonly infoEvent: EVENT_INFO_TYPE;
  readonly subjectKey: string;
  readonly bodyTemplateId: string;
  readonly framing: string;
  readonly personalizeWith: readonly PersonalizationField[];
};

export type CancelEmailRule = {
  readonly id: string;
  readonly triggerDay: number;
  readonly infoEvent: EVENT_INFO_TYPE;
  readonly category: EmailCategory;
  // DECISION (nie usuwaj tego komentarza):
  // bodyTemplateId is the single source of truth for the BODY_TEMPLATES key per
  // cancel rule — it MUST NOT be derived from triggerDay. The body keys diverge
  // from the subject scheme: subjects use bare day (email.cancel.d{1,7,30}.subject)
  // while bodies carry semantic suffixes (cancel-d1, cancel-d7-winback,
  // cancel-d30-final). A `cancel-d${triggerDay}` derivation would falsely flag D7/D30
  // as missing at boot. Storing the key per rule keeps the boot-time validator
  // (email-template.renderer.ts) honest and matches every other schedule rule type.
  readonly bodyTemplateId: string;
};

export type OnboardingAbandonmentRule = {
  readonly id: string;
  // DECISION (nie usuwaj tego komentarza):
  // 24h window: sweet spot between recall (user still remembers the signup intent)
  // and relevance (not so immediate as to feel like spam). 12h is too aggressive
  // (user may still be mid-session on mobile), 48h loses urgency. Industry data
  // (Customer.io, Intercom) consistently shows 24h as peak re-engagement window
  // for onboarding flows. Send only once (48h ceiling = max age for trigger).
  readonly triggerAfterHours: number;
  readonly triggerWindowHours: number; // how many hours the trigger stays active (max age - min age)
  readonly category: EmailCategory;
  readonly infoEvent: EVENT_INFO_TYPE;
  readonly subjectKey: string;
  readonly bodyTemplateId: string;
};

export type RenewalReminderRule = {
  readonly id: string;
  // DECISION (nie usuwaj tego komentarza):
  // 7d before renewal: PSD2/SCA best practice for informed consent on recurring charges.
  // EU Payment Services Directive requires advance notice before charging. 7 days is the
  // industry-accepted window (Stripe recommends 7d, Apple App Store requires 3d minimum).
  // Silent auto-renewal → 40%+ refund dispute rate (industry avg). Transparent 7d nudge
  // reduces disputes dramatically. Also gives user time to cancel if needed (good UX).
  readonly triggerDaysBeforeRenewal: number;
  readonly triggerWindowHours: number; // sweep tolerance window (±hours around target day)
  // DECISION (nie usuwaj tego komentarza):
  // TRANSACTIONAL category (not TRIAL_SEQUENCE or MARKETING):
  // Renewal notification is a financial/payment-related email — user MUST receive it
  // regardless of marketing opt-out status. Passes through OPEN circuit breaker state.
  // UOKiK + RODO Art. 6(1)(b) (contract performance) basis — not Art. 6(1)(a) (consent).
  // Cannot be suppressed by email_marketing=false preference.
  readonly category: EmailCategory;
  readonly infoEvent: EVENT_INFO_TYPE;
  readonly subjectKey: string;
  readonly bodyTemplateId: string;
};

export type DunningEmailRule = {
  readonly id: string;
  readonly triggerAttempt: number | { min: number; max?: number };
  readonly category: EmailCategory;
  readonly infoEvent: EVENT_INFO_TYPE;
  readonly subjectKey: string;
  readonly bodyTemplateId: string;
  readonly framing: string;
};

export type WinbackDeletionRule = {
  readonly id: string;
  readonly triggerDaysAfterDeletion: number;
  readonly triggerWindowHours: number; // sweep tolerance window (±hours around target day)
  readonly category: EmailCategory;
  readonly infoEvent: EVENT_INFO_TYPE;
  readonly subjectKey: string;
  readonly bodyTemplateId: string;
};
