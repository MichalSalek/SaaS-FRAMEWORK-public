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
  /** Compatibility projection for the current default trial duration. */
  readonly triggerDay: number;
  readonly triggerAnchor: 'trial_start' | 'trial_end';
  readonly triggerOffsetDays: number;
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
  // DECISION: bodyTemplateId is the source of truth for the BODY_TEMPLATES key per cancel rule and must
  // NOT be derived from triggerDay: subjects use the bare day (email.cancel.d{1,7,30}.subject) while
  // bodies carry semantic suffixes (cancel-d7-winback, cancel-d30-final), so a `cancel-d${triggerDay}`
  // derivation would falsely flag D7/D30 as missing at boot (validator in email-template.renderer.ts).
  readonly bodyTemplateId: string;
};

export type OnboardingAbandonmentRule = {
  readonly id: string;
  // DECISION: 24h trigger: late enough not to interrupt a signup still in progress (12h is too
  // aggressive on mobile), early enough that the signup intent is remembered (48h loses urgency). Sent
  // once; 48h is the ceiling for the trigger.
  readonly triggerAfterHours: number;
  readonly triggerWindowHours: number; // how many hours the trigger stays active (max age - min age)
  readonly category: EmailCategory;
  readonly infoEvent: EVENT_INFO_TYPE;
  readonly subjectKey: string;
  readonly bodyTemplateId: string;
};

export type RenewalReminderRule = {
  readonly id: string;
  // DECISION: 7 days before renewal gives advance notice of a recurring charge (PSD2/SCA practice,
  // Stripe recommends 7d) and time to cancel; silent auto-renewal drives refund disputes.
  readonly triggerDaysBeforeRenewal: number;
  readonly triggerWindowHours: number; // sweep tolerance window (±hours around target day)
  // DECISION: TRANSACTIONAL, not TRIAL_SEQUENCE or MARKETING: a renewal notice is payment related and
  // must reach the user regardless of marketing opt-out (it is part of the service, not marketing).
  // It passes through an OPEN circuit breaker and cannot be suppressed by
  // email_marketing=false.
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
