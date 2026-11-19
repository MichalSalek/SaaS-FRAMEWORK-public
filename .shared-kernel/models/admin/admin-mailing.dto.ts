import type { EVENT_INFO_TYPE } from '../../domain/commands-and-queries/cqrs.types';

// --- Admin email-template preview ---
//
// Read-only render of any outgoing email template with sample data, for the
// admin panel "Podgląd maili" tool (owner polishes templates visually). The
// backend renders the real production template (renderEmailTemplate) with a
// sample-vars registry — the preview is byte-identical to a sent email minus
// the personalization data.

/** Query: which template + which locale to render. */
export type AdminGetEmailPreviewRequest = {
  templateId: string;
  locale: string;
};

/** Rendered output — same shape renderEmailTemplate returns to the transport. */
export type AdminGetEmailPreviewResponse = {
  from: string;
  replyTo: string;
  preheader: string;
  subject: string;
  html: string;
  text: string;
};

// --- Admin email pipeline (dry run of the lifecycle sweep) ---
//
// What the sweep would send today and within the next 24 h, computed by the
// same resolvers the sweep uses but without sending anything. Covers the trial
// sequence and the onboarding reminder; the weekly frequency cap and quiet
// hours are applied at send time and are not simulated here.

/** One mail the sweep would send. */
export type AdminEmailPipelineSend = {
  userId: string;
  email: string;
  /** Schedule rule id, e.g. TRIAL_D1_NUDGE or ONBOARDING_INCOMPLETE_24H. */
  ruleId: string;
  /** The rule's audit event, the key the admin schedule labels mails by. */
  infoEvent: EVENT_INFO_TYPE;
  templateId: string;
  due: 'today' | 'tomorrow';
};

/** Personal first-month codes minted from lifecycle mails (Stripe). */
export type AdminEmailOfferStats = {
  issued: number;
  redeemed: number;
  /** Unused and not expired yet. */
  active: number;
};

export type AdminFreeEmailCandidate = {
  enrollmentId: string;
  userId: string;
  email: string;
  cohort: string;
  plannedAt: string | null;
  templateId: string | null;
  decision: 'send' | 'skip' | 'finish';
  reason: string;
};
export type AdminFreeEmailPipeline = {
  mode: 'OFF' | 'PREVIEW' | 'ON';
  startedAt: string | null;
  initializedAt: string | null;
  enrolled: number;
  candidates: AdminFreeEmailCandidate[];
};
export type AdminLifecycleEmailHistory = {
  id: string;
  ruleId: string;
  family: string;
  cohort: string;
  locale: string;
  provider: string | null;
  status: string;
  deliveryStatus: string | null;
  plannedAt: string;
  acceptedAt: string | null;
  reason: string | null;
};
export type AdminLifecycleEmailReport = {
  since: string;
  accepted: number;
  delivered: number;
  delayed: number;
  bounced: number;
  complained: number;
  unknown: number;
  rejected: number;
  suppressed: number;
  history: AdminLifecycleEmailHistory[];
};

export type AdminGetEmailPipelineResponse = {
  free: AdminFreeEmailPipeline;
  lifecycle: AdminLifecycleEmailReport;
  /** Last recorded sweep (EMAIL_SWEEP_COMPLETED), null when none on record. */
  lastSweepAt: string | null;
  lastSweepEmailsSent: number | null;
  sweepsLast7Days: number;
  queue: AdminEmailPipelineSend[];
  /** Null when Stripe could not be read; the rest of the panel still works. */
  offers: AdminEmailOfferStats | null;
};
