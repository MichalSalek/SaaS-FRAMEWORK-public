import type { ValueOf } from '../../application/application.utils';
import { TRIAL_CONFIG } from '../stripe/stripe.config';
import type {
  CancelEmailRule,
  DunningEmailRule,
  OnboardingAbandonmentRule,
  RenewalReminderRule,
  TrialEmailRule,
  WinbackDeletionRule,
} from './email-schedule.types';

export const EMAIL_CATEGORY = Object.freeze({
  TRANSACTIONAL: 'TRANSACTIONAL', // upgrade, payment, pairing — cannot unsubscribe
  TRIAL_SEQUENCE: 'TRIAL_SEQUENCE', // trial nurture emails
  MARKETING: 'MARKETING', // win-back, re-engagement
} as const);

export type EmailCategory = ValueOf<typeof EMAIL_CATEGORY>;

// Activation: 3 photos (DOMAIN_SSOT §8.3)
// DECISION (nie usuwaj tego komentarza):
// QR threshold (MIN_QR_GENERATED) was removed pre-launch — QR EventLog
// aggregation is deferred post-launch. Once QR tracking lands, re-add it
// here as MIN_QR_GENERATED + wire activation checks accordingly.
export const ACTIVATION_THRESHOLD = Object.freeze({
  MIN_GALLERY_RECORDS: 3,
} as const);

export const TRIAL_EMAIL_SCHEDULE: readonly TrialEmailRule[] = [
  {
    id: 'TRIAL_D0_WELCOME',
    triggerDay: 0,
    condition: 'ANY',
    category: EMAIL_CATEGORY.TRIAL_SEQUENCE,
    infoEvent: 'EMAIL_WELCOME_SENT',
    subjectKey: 'email.welcome.subject',
    bodyTemplateId: 'welcome',
    framing: 'Reciprocity',
    personalizeWith: ['displayName'],
  },
  {
    id: 'TRIAL_D1_NUDGE',
    triggerDay: 1,
    condition: 'INACTIVE',
    category: EMAIL_CATEGORY.TRIAL_SEQUENCE,
    infoEvent: 'EMAIL_TRIAL_D1_NUDGE_SENT',
    subjectKey: 'email.trial.d1Nudge.subject',
    bodyTemplateId: 'trial-nudge-upload',
    framing: 'Commitment',
    personalizeWith: ['displayName'],
  },
  {
    id: 'TRIAL_D3_INACTIVE',
    triggerDay: 3,
    condition: 'INACTIVE',
    category: EMAIL_CATEGORY.TRIAL_SEQUENCE,
    infoEvent: 'EMAIL_TRIAL_D3_INACTIVE_SENT',
    subjectKey: 'email.trial.d3Inactive.subject',
    bodyTemplateId: 'trial-empty-portfolio',
    framing: 'Loss aversion',
    personalizeWith: ['displayName', 'planName', 'trialDaysLeft'],
  },
  {
    id: 'TRIAL_D3_ACTIVE',
    triggerDay: 3,
    condition: 'ACTIVE',
    category: EMAIL_CATEGORY.TRIAL_SEQUENCE,
    infoEvent: 'EMAIL_TRIAL_D3_ACTIVE_SENT',
    subjectKey: 'email.trial.d3Active.subject',
    bodyTemplateId: 'trial-celebration',
    framing: 'Endowment + next step',
    personalizeWith: ['displayName', 'galleryCount'],
  },
  {
    id: 'TRIAL_D7_ACTIVE',
    triggerDay: 7,
    condition: 'ACTIVE',
    category: EMAIL_CATEGORY.TRIAL_SEQUENCE,
    infoEvent: 'EMAIL_TRIAL_D7_ACTIVE_SENT',
    subjectKey: 'email.trial.d7Active.subject',
    bodyTemplateId: 'trial-progress',
    framing: 'Endowment, personalizacja',
    personalizeWith: [
      'displayName',
      'galleryCount',
      'pairedClientsCount',
      'planName',
    ],
  },
  {
    id: 'TRIAL_D7_INACTIVE',
    triggerDay: 7,
    condition: 'INACTIVE',
    category: EMAIL_CATEGORY.TRIAL_SEQUENCE,
    infoEvent: 'EMAIL_TRIAL_D7_INACTIVE_SENT',
    subjectKey: 'email.trial.d7Inactive.subject',
    bodyTemplateId: 'trial-social-proof',
    framing: 'Social proof + value',
    personalizeWith: ['displayName', 'planName', 'trialDaysLeft'],
  },
  {
    id: 'TRIAL_D14_ACTIVE',
    triggerDay: 14,
    condition: 'ACTIVE',
    category: EMAIL_CATEGORY.TRIAL_SEQUENCE,
    infoEvent: 'EMAIL_TRIAL_D14_ACTIVE_SENT',
    subjectKey: 'email.trial.d14Active.subject',
    bodyTemplateId: 'trial-milestone',
    framing: 'Endowment, podsumowanie',
    personalizeWith: [
      'displayName',
      'galleryCount',
      'pairedClientsCount',
      'trialDaysLeft',
      'planName',
    ],
  },
  {
    id: 'TRIAL_D14_INACTIVE',
    triggerDay: 14,
    condition: 'INACTIVE',
    category: EMAIL_CATEGORY.TRIAL_SEQUENCE,
    infoEvent: 'EMAIL_TRIAL_D14_INACTIVE_SENT',
    subjectKey: 'email.trial.d14Inactive.subject',
    bodyTemplateId: 'trial-fomo',
    framing: 'Loss aversion',
    personalizeWith: ['displayName', 'planName', 'trialDaysLeft'],
  },
  {
    id: 'TRIAL_D23_WARNING',
    triggerDay: 23,
    condition: 'ANY',
    category: EMAIL_CATEGORY.TRIAL_SEQUENCE,
    infoEvent: 'EMAIL_TRIAL_D23_WARNING_SENT',
    subjectKey: 'email.trial.d23Warning.subject',
    bodyTemplateId: 'trial-warning',
    framing: 'Loss + endowment',
    personalizeWith: [
      'displayName',
      'galleryCount',
      'pairedClientsCount',
      'planName',
      'trialEndDate',
    ],
  },
  {
    id: 'TRIAL_D29_LAST_DAY',
    triggerDay: 29,
    condition: 'ANY',
    category: EMAIL_CATEGORY.TRIAL_SEQUENCE,
    infoEvent: 'EMAIL_TRIAL_D29_LAST_DAY_SENT',
    subjectKey: 'email.trial.d29LastDay.subject',
    bodyTemplateId: 'trial-last-day',
    framing: 'Urgency + clear options',
    personalizeWith: [
      'displayName',
      'galleryCount',
      'pairedClientsCount',
      'planName',
      'funnelPlanId',
      'offerCode',
      'offerExpiresAt',
    ],
  },
  {
    id: 'TRIAL_D30_ENDED',
    triggerDay: 30,
    condition: 'ANY',
    category: EMAIL_CATEGORY.TRIAL_SEQUENCE,
    infoEvent: 'EMAIL_TRIAL_D30_ENDED_SENT',
    subjectKey: 'email.trial.d30Ended.subject',
    bodyTemplateId: 'trial-ended',
    framing: 'Downgrade path',
    personalizeWith: [
      'displayName',
      'planName',
      'galleryCount',
      'funnelPlanId',
    ],
  },
  {
    id: 'TRIAL_D37_WINBACK',
    triggerDay: 37,
    condition: 'ANY',
    category: EMAIL_CATEGORY.MARKETING,
    infoEvent: 'EMAIL_TRIAL_D37_WINBACK_SENT',
    subjectKey: 'email.trial.d37Winback.subject',
    bodyTemplateId: 'trial-winback',
    framing: 'Win-back offer',
    personalizeWith: [
      'displayName',
      'galleryCount',
      'planName',
      'funnelPlanId',
      'offerCode',
      'offerExpiresAt',
    ],
  },
] as const;

// DECISION (nie usuwaj tego komentarza):
// Day 0 is the created_at of the latest EventLog ADMIN_PRICING_PLAN_CHANGED
// (ACCOUNT) with newPricingPlan=FREE, source=stripe, oldPricingPlan!=FREE.
// Stripe nulls cancel_at and current_period_end on subscription.deleted, so
// that event is the only reliable cancel date. The sender
// (cancel-sequence.operation.ts) excludes accounts still inside
// POST_TRIAL_AUDIENCE_WINDOW_DAYS so D30/D37 and this sequence do not both fire.
export const CANCEL_EMAIL_SCHEDULE: readonly CancelEmailRule[] = [
  {
    id: 'CANCEL_D1',
    triggerDay: 1,
    infoEvent: 'EMAIL_CANCEL_D1_SENT',
    category: EMAIL_CATEGORY.TRANSACTIONAL,
    bodyTemplateId: 'cancel-d1',
  },
  {
    id: 'CANCEL_D7_WINBACK',
    triggerDay: 7,
    infoEvent: 'EMAIL_CANCEL_D7_WINBACK_SENT',
    category: EMAIL_CATEGORY.MARKETING,
    bodyTemplateId: 'cancel-d7-winback',
  },
  {
    id: 'CANCEL_D30_FINAL',
    triggerDay: 30,
    infoEvent: 'EMAIL_CANCEL_D30_FINAL_SENT',
    category: EMAIL_CATEGORY.MARKETING,
    bodyTemplateId: 'cancel-d30-final',
  },
] as const;

export const DUNNING_EMAIL_SCHEDULE: readonly DunningEmailRule[] = [
  {
    id: 'DUNNING_D1_INFO',
    triggerAttempt: 1,
    category: EMAIL_CATEGORY.TRANSACTIONAL,
    infoEvent: 'EMAIL_DUNNING_D1_INFO_SENT',
    subjectKey: 'email.dunning.d1Info.subject',
    bodyTemplateId: 'dunning-info',
    framing: 'Neutralny, bez paniki',
  },
  {
    id: 'DUNNING_D7_URGENT',
    triggerAttempt: { min: 2, max: 3 },
    category: EMAIL_CATEGORY.TRANSACTIONAL,
    infoEvent: 'EMAIL_DUNNING_D7_URGENT_SENT',
    subjectKey: 'email.dunning.d7Urgent.subject',
    bodyTemplateId: 'dunning-urgent',
    framing: 'Pilny, endowment',
  },
  {
    id: 'DUNNING_D14_FINAL',
    triggerAttempt: { min: 4 },
    category: EMAIL_CATEGORY.TRANSACTIONAL,
    infoEvent: 'EMAIL_DUNNING_D14_FINAL_SENT',
    subjectKey: 'email.dunning.d14Final.subject',
    bodyTemplateId: 'dunning-final',
    framing: 'Ostateczny, loss aversion',
  },
] as const;

/** Day after which an unpaid account is auto-downgraded to Free */
export const DUNNING_AUTO_DOWNGRADE_DAY = 15 as const;

// DECISION (nie usuwaj tego komentarza):
// Onboarding abandonment: single rule (no schedule array) — simpler to reason about.
// One email per user lifetime (idempotency via EventLog EVENT_INFO_TYPE sentinel).
// 24h min / 48h max window: avoids re-triggering on sweep timing jitter.
export const ONBOARDING_ABANDONMENT_RULE: OnboardingAbandonmentRule =
  Object.freeze({
    id: 'ONBOARDING_INCOMPLETE_24H',
    triggerAfterHours: 24,
    triggerWindowHours: 24, // send between 24h and 48h after signup
    category: EMAIL_CATEGORY.TRIAL_SEQUENCE,
    infoEvent: 'EMAIL_ONBOARDING_INCOMPLETE_24H_SENT',
    subjectKey: 'email.onboarding.incomplete24h.subject',
    bodyTemplateId: 'onboarding-incomplete',
  } as const);

// DECISION (nie usuwaj tego komentarza):
// Renewal reminder: ±12h sweep tolerance window around the 7d target.
// Sweep runs every 6h max — a 24h tolerance window guarantees the email lands
// in the 6-8d-before-renewal range even with sweep timing jitter or quiet hours.
// ONE-TIME per renewal period: idempotency via EventLog check within current_period
// (not per user lifetime — they get a fresh reminder each renewal cycle).
export const RENEWAL_REMINDER_RULE: RenewalReminderRule = Object.freeze({
  id: 'RENEWAL_REMINDER_7D',
  triggerDaysBeforeRenewal: 7,
  triggerWindowHours: 24, // send when current_period_end is 6-8d away
  category: EMAIL_CATEGORY.TRANSACTIONAL,
  infoEvent: 'EMAIL_RENEWAL_REMINDER_7D_SENT',
  subjectKey: 'email.renewal.reminder7d.subject',
  bodyTemplateId: 'renewal-reminder',
} as const);

// DECISION (nie usuwaj tego komentarza):
// Win-back po usunięciu konta (D60): ~dzień 60 z 90-dniowego okna recovery.
// Mail niesie ten sam kod 20% co D37 (EMAIL_OFFERS.FIRST_MONTH),
// tylko gdy Stripe go utworzy. SENDER: winback-deletion.operation.ts
// (recovery_available + deleted_at ~60d, opt-out MARKETING, dedup
// EMAIL_WINBACK_DELETION_D60_SENT) + safeStep w orchestratorze.
export const WINBACK_DELETION_RULE: WinbackDeletionRule = Object.freeze({
  id: 'WINBACK_DELETION_D60',
  triggerDaysAfterDeletion: 60,
  triggerWindowHours: 24, // send when deleted_at is 59.5-60.5d ago (±triggerWindowHours/2 = ±12h)
  category: EMAIL_CATEGORY.MARKETING,
  infoEvent: 'EMAIL_WINBACK_DELETION_D60_SENT',
  subjectKey: 'email.winback.deletionD60.subject',
  bodyTemplateId: 'winback-deletion-d60',
} as const);

export const EMAIL_FREQUENCY_CAP = Object.freeze({
  MAX_PER_WEEK: 2,
  EXEMPT_CATEGORIES: ['TRANSACTIONAL'] as readonly EmailCategory[],
} as const);

// DECISION (nie usuwaj tego komentarza):
// EMAIL_PRIORITY_ORDER was removed pre-launch — it referenced ghost categories
// (DUNNING, LIFECYCLE) that do not exist in EMAIL_CATEGORY, and had zero
// consumers in the codebase. Re-introduce only if/when an actual priority-based
// queue is implemented, using categories from EMAIL_CATEGORY.

export const EMAIL_LIFECYCLE_CONFIG = Object.freeze({
  SWEEP_THROTTLE_MS: 6 * 60 * 60 * 1000, // 6h
  QUIET_HOURS_START: 21, // UTC
  QUIET_HOURS_END: 9, // UTC
  MAX_EMAILS_PER_SWEEP: 50,
  SWEEP_CONCURRENCY: 5,
  UNSUBSCRIBE_TOKEN_TTL_DAYS: 365,
  // A due rule is sent only while trialDay - triggerDay <= this many days.
  // After the audience fix, the first live sweep would otherwise dump every
  // missed nudge (D1, D3, ...) onto an account already mid-trial. Stale rules
  // are skipped: not sent, not written to EventLog. 2 days covers the 6h
  // throttle plus quiet hours (21:00-09:00 UTC) with margin.
  CATCHUP_WINDOW_DAYS: 2,
} as const);

// How long after trial_ends_at a non-converted account stays in the trial-sweep
// audience, so D30 ("ended") and D37 ("win-back") can still fire.
//
// Post-trial rules are schedule rows whose triggerDay is at or after the Stripe
// trial length. The offset is that largest trigger minus the trial length
// (D37 on a 30-day trial = 7 days after trial_ends_at). Slack is the catch-up
// window plus one day: trialDay is Math.floor, so the last eligible day runs
// until the next day boundary and a `gte` cutoff of exactly offset+catch-up
// would drop the account mid-day.
const postTrialTriggerDays = TRIAL_EMAIL_SCHEDULE.map(
  rule => rule.triggerDay
).filter(day => day >= TRIAL_CONFIG.DURATION_DAYS);
const largestPostTrialTriggerDay = postTrialTriggerDays.reduce(
  (max, day) => (day > max ? day : max),
  TRIAL_CONFIG.DURATION_DAYS
);
const TRIAL_DAY_FLOOR_SLACK_DAYS = 1;
export const POST_TRIAL_AUDIENCE_WINDOW_DAYS =
  largestPostTrialTriggerDay -
  TRIAL_CONFIG.DURATION_DAYS +
  EMAIL_LIFECYCLE_CONFIG.CATCHUP_WINDOW_DAYS +
  TRIAL_DAY_FLOOR_SLACK_DAYS;

// DECISION (nie usuwaj tego komentarza):
// EMAIL_SWEEP_TUNING — granice zapytania lookup w trial-sweep (NIE limit wysyłki).
// EVENTS_LOOKBACK_PER_USER (50): ile wierszy EventLog pobrać PER zmieciony
// użytkownik przy budowie zbioru already-sent (pokrywa ~10 wpisów schedule × kilka
// wysyłek). MAX_EVENTS_PER_QUERY (10_000): absolutny runaway-cap na zbatchowane
// zapytanie events (userIds.length × per-user, sklampowane). To pokrętła tuningu
// zapytania — limit WYSYŁKI to EMAIL_LIFECYCLE_CONFIG.MAX_EMAILS_PER_SWEEP, osobna rzecz.
// MAX_SWEEP_PAGES (10): ile stron po MAX_EMAILS_PER_SWEEP wierszy sweep może
// przejść, zanim odda resztę następnemu przebiegowi. Strony istnieją, bo konta
// z niczym do wysłania (już obsłużone) też zajmują wiersz: bez nich te same
// najstarsze 50 kont zajmowało każdy przebieg i nowe nie dostawały powitania.
export const EMAIL_SWEEP_TUNING = Object.freeze({
  EVENTS_LOOKBACK_PER_USER: 50,
  MAX_EVENTS_PER_QUERY: 10_000,
  MAX_SWEEP_PAGES: 10,
} as const);
