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
// Activation is gallery-only for now; a QR threshold is not wired (re-add as MIN_QR_GENERATED together
// with the activation checks if QR tracking lands).
export const ACTIVATION_THRESHOLD = Object.freeze({
  MIN_GALLERY_RECORDS: 3,
} as const);

const TRIAL_EMAIL_RULES = [
  {
    id: 'TRIAL_D0_WELCOME',
    triggerAnchor: 'trial_start',
    triggerOffsetDays: 0,
    condition: 'ANY',
    category: EMAIL_CATEGORY.TRANSACTIONAL,
    infoEvent: 'EMAIL_WELCOME_SENT',
    subjectKey: 'email.welcome.subject',
    bodyTemplateId: 'welcome',
    framing: 'Reciprocity',
    personalizeWith: ['displayName'],
  },
  {
    id: 'TRIAL_D1_NUDGE',
    triggerAnchor: 'trial_start',
    triggerOffsetDays: 1,
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
    triggerAnchor: 'trial_start',
    triggerOffsetDays: 3,
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
    triggerAnchor: 'trial_start',
    triggerOffsetDays: 3,
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
    triggerAnchor: 'trial_start',
    triggerOffsetDays: 7,
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
    triggerAnchor: 'trial_start',
    triggerOffsetDays: 7,
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
    triggerAnchor: 'trial_start',
    triggerOffsetDays: 14,
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
    triggerAnchor: 'trial_start',
    triggerOffsetDays: 14,
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
    triggerAnchor: 'trial_start',
    triggerOffsetDays: 23,
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
    triggerAnchor: 'trial_start',
    triggerOffsetDays: 29,
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
    triggerAnchor: 'trial_end',
    triggerOffsetDays: 0,
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
    triggerAnchor: 'trial_end',
    triggerOffsetDays: 7,
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
] as const satisfies readonly Omit<TrialEmailRule, 'triggerDay'>[];

// Legacy API clients read triggerDay as an approximation for the current default cohort.
// Scheduling always uses the explicit anchor and the individual account dates.
export const TRIAL_EMAIL_SCHEDULE: readonly TrialEmailRule[] =
  TRIAL_EMAIL_RULES.map(rule => ({
    ...rule,
    triggerDay:
      rule.triggerOffsetDays +
      (rule.triggerAnchor === 'trial_end' ? TRIAL_CONFIG.DURATION_DAYS : 0),
  }));

// DECISION: day 0 is the created_at of the latest ADMIN_PRICING_PLAN_CHANGED EventLog row (ACCOUNT)
// with newPricingPlan=FREE, source=stripe, oldPricingPlan!=FREE. Stripe nulls cancel_at and
// current_period_end on subscription.deleted, so that row is the only reliable cancel date. The
// sender (cancel-sequence.operation.ts) excludes accounts still inside
// POST_TRIAL_AUDIENCE_WINDOW_DAYS so D30/D37 and this sequence never both fire.
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

// DECISION: a single rule targets signup age 24-48h. The sender checks an EventLog sentinel
// before sending and records accepted delivery afterward. This read-then-send mechanism does
// not exclude concurrent sends or a retry after delivery succeeds but the audit write fails.
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

// DECISION: renewal reminders target current_period_end 6-8d away, allowing sweep jitter and
// quiet hours within that window. The sender skips users recorded in EventLog in the last
// 25 days; this is a lookback filter, not a claim keyed by renewal period. Delivery and its
// audit write are separate, so a missing audit row can permit a later resend.
export const RENEWAL_REMINDER_RULE: RenewalReminderRule = Object.freeze({
  id: 'RENEWAL_REMINDER_7D',
  triggerDaysBeforeRenewal: 7,
  triggerWindowHours: 24, // send when current_period_end is 6-8d away
  category: EMAIL_CATEGORY.TRANSACTIONAL,
  infoEvent: 'EMAIL_RENEWAL_REMINDER_7D_SENT',
  subjectKey: 'email.renewal.reminder7d.subject',
  bodyTemplateId: 'renewal-reminder',
} as const);

// DECISION: win-back after account deletion (D60) lands about day 60 of the 90-day recovery window.
// The mail carries the same 20% code as D37 (EMAIL_OFFERS.FIRST_MONTH) only when Stripe issued it.
// Sender: winback-deletion.operation.ts (opt-out MARKETING, dedup EMAIL_WINBACK_DELETION_D60_SENT).
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
// The end-anchored offsets apply to each actual trial end, independent of its duration.
// Include one extra day because catch-up uses floored whole days.
const largestPostTrialOffset = TRIAL_EMAIL_SCHEDULE.filter(
  rule => rule.triggerAnchor === 'trial_end'
).reduce((max, rule) => Math.max(max, rule.triggerOffsetDays), 0);
const TRIAL_DAY_FLOOR_SLACK_DAYS = 1;
export const POST_TRIAL_AUDIENCE_WINDOW_DAYS =
  largestPostTrialOffset +
  EMAIL_LIFECYCLE_CONFIG.CATCHUP_WINDOW_DAYS +
  TRIAL_DAY_FLOOR_SLACK_DAYS;

// DECISION: EMAIL_SWEEP_TUNING bounds the trial-sweep lookup queries, NOT the send limit (that is
// EMAIL_LIFECYCLE_CONFIG.MAX_EMAILS_PER_SWEEP). EVENTS_LOOKBACK_PER_USER: EventLog rows fetched per
// swept user for the already-sent set. MAX_EVENTS_PER_QUERY: runaway cap on the batched events query.
// MAX_SWEEP_PAGES: pages of MAX_EMAILS_PER_SWEEP rows per run before the rest waits for the next
// run; pages exist because accounts with nothing to send still occupy a row, and without paging the
// same oldest 50 accounts took every run so new accounts never got the welcome.
export const EMAIL_SWEEP_TUNING = Object.freeze({
  EVENTS_LOOKBACK_PER_USER: 50,
  MAX_EVENTS_PER_QUERY: 10_000,
  MAX_SWEEP_PAGES: 10,
} as const);

export { FREE_EMAIL_CONFIG, FREE_EMAIL_RULES } from './email-free.config';
export type { FreeEmailMode, FreeEmailTemplateId } from './email-free.config';
