// application/analytics/flow-events.ts
//
// DECISION: every step of every user process leaves a NAMED event the moment it happens
// (owner). Autocapture and replays stay, but only named events can be counted or put in
// a funnel. One event name per step, `<flow>_<step>`, plus `flow` and `step` properties. The
// registry below is the SSOT: an unlisted step does not compile, and ANALYTICS_TRACKING_PLAN.md
// §3.6 mirrors it. Rules for callers:
//  - fire on the OUTCOME (mutation onSuccess / onError, a phase change), not on a render, so a
//    refetch or a StrictMode double effect never counts twice;
//  - properties carry facts about the step (source, count, plan, error code), NEVER personal data;
//  - fire-and-forget, never before the user action.
// Every event also becomes a Clarity custom event, so recordings can be filtered by step.

import { withLifecycleActionProperties } from './email-lifecycle';
import { clarity, emitAnalyticsEvent } from './analytics-sinks';
import type { AnalyticsEventProps } from './analytics-sinks';
import { takePurchaseResumeOutcome } from './purchase-resume-outcome';

export const FLOW_STEPS = {
  /** Login and registration (magic link, Google, the link exchange). */
  auth: [
    'magic_link_sent',
    'magic_link_failed',
    'magic_link_resent',
    'email_changed',
    'google_failed',
    'code_exchanged',
    'code_exchange_failed',
    'login_confirmed',
    'login_rejected',
  ],
  /** Account setup right after the first login. */
  onboarding: [
    'viewed',
    'role_selected',
    'submitted',
    'failed',
    'checkout_viewed',
  ],
  /** Public profile card the stylist fills after the first photo. */
  profile_prompt: ['shown', 'saved', 'skipped', 'failed'],
  /** Adding a photo to the gallery. */
  upload: [
    'started',
    'source_chosen',
    'photo_selected',
    'cropped',
    'details_viewed',
    'published',
    'failed',
    'retried',
    'abandoned',
  ],
  /** Editing or deleting a published photo. */
  photo: ['edited', 'deleted', 'shared'],
  /** Pinning photos to the public profile. */
  pin: ['pinned', 'unpinned', 'failed'],
  /** The public profile editor and its avatar. */
  profile: ['saved', 'failed', 'avatar_uploaded', 'avatar_removed', 'shared'],
  /** Salon profile configuration. */
  salon_profile: ['published', 'saved', 'failed', 'visibility_changed'],
  /** Client ↔ stylist connection. */
  pairing: [
    'scanner_opened',
    'scan_succeeded',
    'scan_failed',
    'request_sent',
    'request_accepted',
    'request_declined',
    'request_failed',
    'request_cancelled',
    'unpaired',
    'free_slot_dialog_shown',
  ],
  /** Inspiration session from creation to close. */
  session: [
    'created',
    'photo_added',
    'photo_removed',
    'note_saved',
    'shared',
    'opened',
    'accepted',
    'activity_opened',
    'conversation_opened',
    'opened_by_stylist',
    'closed',
    'failed',
  ],
  /** Messages. */
  message: [
    'sent',
    'profile_contact_opened',
    'contact_ended',
    'failed',
    'salon_contacted',
    'conversation_hidden',
    'conversation_restored',
  ],
  /** Paying for a plan or changing it. */
  checkout: [
    'session_created',
    'pay_clicked',
    'payment_succeeded',
    'payment_failed',
    'confirmation_unknown',
    'plan_changed',
    'portal_returned',
    'session_failed',
    'plan_change_failed',
  ],
  purchase_resume: ['saved', 'offered', 'resumed', 'dismissed', 'completed'],
  /** Salon team membership. */
  salon_team: [
    'invite_sent',
    'invite_failed',
    'invitation_accepted',
    'invitation_declined',
    'member_removed',
    'member_left',
    'permissions_changed',
    'failed',
  ],
  /** Support requests. */
  support: ['thread_created', 'reply_sent', 'failed'],
  /** Account lifecycle. */
  account: [
    'role_switched',
    'role_activated',
    'deletion_requested',
    'disabled',
    'reactivated',
    'erased',
    'email_change_requested',
    'data_exported',
    'failed',
  ],
  /** Client favourites and saved stylists. */
  favorites: [
    'photo_liked',
    'photo_unliked',
    'stylist_saved',
    'stylist_unsaved',
    'note_saved',
  ],
  /** The stylist's client card (visits, CRM note). */
  client_card: [
    'visit_added',
    'visit_edited',
    'visit_deleted',
    'note_saved',
    'important_note_saved',
  ],
  /** Reporting a photo. */
  moderation: ['report_sent'],
  /** Notification centre and push devices (notifications v2). */
  notifications: [
    'opened',
    'row_opened',
    'push_prompted',
    'push_granted',
    'push_denied',
    'push_subscribed',
    'push_unsubscribed',
    'push_failed',
    'soft_ask_shown',
    'soft_ask_accepted',
    'soft_ask_dismissed',
  ],
} as const;

export type ProductFlow = keyof typeof FLOW_STEPS;
export type FlowStep<F extends ProductFlow> = (typeof FLOW_STEPS)[F][number];

export function trackFlowStep<F extends ProductFlow>(
  flow: F,
  step: FlowStep<F>,
  props: AnalyticsEventProps = {}
): void {
  const name = `${flow}_${step}`;
  const attributed =
    (flow === 'upload' && step === 'published') ||
    (flow === 'pin' && step === 'pinned') ||
    (flow === 'profile' && step === 'shared');
  if (attributed) {
    withLifecycleActionProperties(attribution =>
      emitAnalyticsEvent(name, { ...props, flow, step, ...attribution })
    );
  } else {
    emitAnalyticsEvent(name, { ...props, flow, step });
  }
  clarity('event', name);
  const resumedAction = takePurchaseResumeOutcome(flow, step);
  if (resumedAction) {
    emitAnalyticsEvent('purchase_resume_completed', {
      flow: 'purchase_resume',
      step: 'completed',
      action: resumedAction,
      measurement_version: 1,
    });
  }
}
