/**
 * Email Preview Catalog — SSOT list of previewable outgoing templates.
 *
 * Shared by the backend (web-1 renders + validates templateId) and the frontend
 * (main populates the admin selector). templateId ↔ subjectKey pairs mirror
 * email-schedule.config (lifecycle rules) + the direct transactional senders.
 * Pure data — no runtime deps, FE-importable.
 */

export type EmailPreviewGroup =
  | 'auth'
  | 'onboarding'
  | 'trial'
  | 'billing'
  | 'pairing'
  | 'account'
  | 'newsletter';

export type EmailPreviewSpec = {
  /** BODY_TEMPLATES key + templateId passed to renderEmailTemplate. */
  id: string;
  /** i18n subject key (SUBJECTS map). */
  subjectKey: string;
  /** UI grouping for the selector. */
  group: EmailPreviewGroup;
};

/** All previewable templates, grouped + ordered for the admin selector. */
export const EMAIL_PREVIEW_TEMPLATES: readonly EmailPreviewSpec[] =
  Object.freeze([
    // Auth
    { id: 'magic-link', subjectKey: 'email.magicLink.subject', group: 'auth' },
    // Onboarding
    { id: 'welcome', subjectKey: 'email.welcome.subject', group: 'onboarding' },
    {
      id: 'onboarding-incomplete',
      subjectKey: 'email.onboarding.incomplete24h.subject',
      group: 'onboarding',
    },
    // Trial lifecycle
    {
      id: 'trial-nudge-upload',
      subjectKey: 'email.trial.d1Nudge.subject',
      group: 'trial',
    },
    {
      id: 'trial-empty-portfolio',
      subjectKey: 'email.trial.d3Inactive.subject',
      group: 'trial',
    },
    {
      id: 'trial-celebration',
      subjectKey: 'email.trial.d3Active.subject',
      group: 'trial',
    },
    {
      id: 'trial-progress',
      subjectKey: 'email.trial.d7Active.subject',
      group: 'trial',
    },
    {
      id: 'trial-social-proof',
      subjectKey: 'email.trial.d7Inactive.subject',
      group: 'trial',
    },
    {
      id: 'trial-milestone',
      subjectKey: 'email.trial.d14Active.subject',
      group: 'trial',
    },
    {
      id: 'trial-fomo',
      subjectKey: 'email.trial.d14Inactive.subject',
      group: 'trial',
    },
    {
      id: 'trial-warning',
      subjectKey: 'email.trial.d23Warning.subject',
      group: 'trial',
    },
    {
      id: 'trial-last-day',
      subjectKey: 'email.trial.d29LastDay.subject',
      group: 'trial',
    },
    {
      id: 'trial-ended',
      subjectKey: 'email.trial.d30Ended.subject',
      group: 'trial',
    },
    {
      id: 'trial-winback',
      subjectKey: 'email.trial.d37Winback.subject',
      group: 'trial',
    },
    // Billing
    {
      id: 'upgrade-confirmation',
      subjectKey: 'email.upgrade.subject',
      group: 'billing',
    },
    {
      id: 'downgrade-notification',
      subjectKey: 'email.downgrade.subject',
      group: 'billing',
    },
    {
      id: 'payment-failed',
      subjectKey: 'email.paymentFailed.subject',
      group: 'billing',
    },
    {
      id: 'dunning-info',
      subjectKey: 'email.dunning.d1Info.subject',
      group: 'billing',
    },
    {
      id: 'dunning-urgent',
      subjectKey: 'email.dunning.d7Urgent.subject',
      group: 'billing',
    },
    {
      id: 'dunning-final',
      subjectKey: 'email.dunning.d14Final.subject',
      group: 'billing',
    },
    {
      id: 'cancel-d1',
      subjectKey: 'email.cancel.d1.subject',
      group: 'billing',
    },
    {
      id: 'cancel-d7-winback',
      subjectKey: 'email.cancel.d7.subject',
      group: 'billing',
    },
    {
      id: 'cancel-d30-final',
      subjectKey: 'email.cancel.d30.subject',
      group: 'billing',
    },
    {
      id: 'renewal-reminder',
      subjectKey: 'email.renewal.reminder7d.subject',
      group: 'billing',
    },
    // Pairing / client↔stylist
    {
      id: 'pairing-notification',
      subjectKey: 'email.pairingNotification.subject',
      group: 'pairing',
    },
    {
      id: 'pair-request-notification',
      subjectKey: 'email.pairRequestNotification.subject',
      group: 'pairing',
    },
    {
      id: 'session-shared-notification',
      subjectKey: 'email.sessionSharedNotification.subject',
      group: 'pairing',
    },
    {
      id: 'messaging-notification',
      subjectKey: 'email.messagingNotification.subject',
      group: 'pairing',
    },
    {
      id: 'salon-staff-invitation',
      subjectKey: 'email.salonStaffInvitation.subject',
      group: 'pairing',
    },
    // Account lifecycle
    {
      id: 'account-delete-confirm',
      subjectKey: 'email.accountDeleteConfirm.subject',
      group: 'account',
    },
    {
      id: 'account-deleted-recovery',
      subjectKey: 'email.accountDeletedRecovery.subject',
      group: 'account',
    },
    {
      id: 'email-change-confirm',
      subjectKey: 'email.changeEmail.confirm.subject',
      group: 'account',
    },
    {
      id: 'email-change-notify',
      subjectKey: 'email.changeEmail.notify.subject',
      group: 'account',
    },
    {
      id: 'winback-deletion-d60',
      subjectKey: 'email.winback.deletionD60.subject',
      group: 'account',
    },
    {
      id: 'support-reply-notification',
      subjectKey: 'email.support.reply.subject',
      group: 'account',
    },
    {
      id: 'moderation-owner-notification',
      subjectKey: 'email.moderation.owner.subject',
      group: 'account',
    },
    // Newsletter
    {
      id: 'newsletter-confirm',
      subjectKey: 'email.newsletter.confirm.subject',
      group: 'newsletter',
    },
  ]);

const PREVIEW_BY_ID: ReadonlyMap<string, EmailPreviewSpec> = new Map(
  EMAIL_PREVIEW_TEMPLATES.map(spec => [spec.id, spec])
);

/** Resolve the preview spec for a templateId, or null if it is not previewable. */
export const getEmailPreviewSpec = (
  templateId: string
): EmailPreviewSpec | null => PREVIEW_BY_ID.get(templateId) ?? null;
