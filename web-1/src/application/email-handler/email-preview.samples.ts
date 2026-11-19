/**
 * Email Preview Samples — sample-data for the admin "Podgląd maili" tool.
 *
 * The previewable-template CATALOG (id ↔ subjectKey ↔ group) is the kernel SSOT
 * (`email-preview.catalog.ts`, shared with the frontend selector). This module
 * owns only the backend-side sample personalization vars: `renderEmailTemplate`
 * gets rendered with the SAME production function as a sent mail, so the preview
 * is byte-identical minus the data.
 *
 * `interpolatePiece` substitutes only the placeholders a template actually uses
 * and drops the rest, so base vars cover shared fields; getSampleEmailVars adds localized
 * renewal samples (extra keys are harmless).
 */

import type { LocaleType } from '@kernel/domain/i18n/i18n.config';
import { formatEmailCurrency } from './email-currency.format';
import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
import {
  TRIAL_EMAIL_SCHEDULE,
  CANCEL_EMAIL_SCHEDULE,
  ONBOARDING_ABANDONMENT_RULE,
  WINBACK_DELETION_RULE,
} from '@kernel/domain/email/email-schedule.config';
import { FREE_EMAIL_RULES } from '@kernel/domain/email/email-free.config';

const APP = BRAND_CONFIG.url;

const OPTIONAL_TEMPLATES = new Set([
  ...[
    ...TRIAL_EMAIL_SCHEDULE,
    ...CANCEL_EMAIL_SCHEDULE,
    ONBOARDING_ABANDONMENT_RULE,
    WINBACK_DELETION_RULE,
  ]
    .filter(rule => rule.category !== 'TRANSACTIONAL')
    .map(rule => rule.bodyTemplateId),
  ...Object.keys(FREE_EMAIL_RULES),
]);

/** Delivery rules decide which previews carry an illustrative unsubscribe link. */
export const getSampleUnsubscribeUrl = (templateId: string): string =>
  OPTIONAL_TEMPLATES.has(templateId)
    ? `${APP}/api/v1/email/unsubscribe?token=SAMPLE-TOKEN`
    : '';

/**
 * Base {{placeholder}} values used across the i18n email bodies + the
 * caller-controlled url vars read directly in the body generators. Values are
 * illustrative sample data (no real PII). appUrl is intentionally omitted so the
 * renderer falls back to BRAND_CONFIG.url and CTA paths resolve to real URLs.
 */
export const BASE_SAMPLE_VARS: Readonly<Record<string, string>> = Object.freeze(
  {
    // i18n body placeholders
    displayName: 'Anna Kowalska',
    clientName: 'Marta',
    senderName: 'Marta Nowak',
    inviterName: 'Ola Wiśniewska',
    salonName: 'Studio Oli',
    invitationUrl: `${APP}/salon-invitation?token=SAMPLE-TOKEN`,
    galleryCount: '12',
    pairedClientsCount: '3',
    planName: 'Pro',
    funnelPlanId: 'PRO',
    promoCode: 'SAMPLE30',
    offerCode: 'ANNA-7K2Q',
    offerExpiresAt: '26 września 2026, 18:00',
    offerApplied: '1',
    trialDaysLeft: '7',
    trialEndDate: '30 września 2026',
    renewalDate: '30 września 2026',
    threadId: 'thread-sample',
    threadSubject: 'Pytanie o wizytówkę',
    replyPreview:
      'Dziękujemy za wiadomość. Sprawdziliśmy konto i odpowiedź jest w wątku.',
    moderationAction: 'HIDE',
    galleryRecordId: 'rec-sample',
    adminNote: 'Zdjęcie nie pokazuje stylizacji.',
    sessionId: 'session-sample',
    newEmail: 'nowy.adres@example.com',
    // caller-controlled URL vars (magic-link / confirm / login flows)
    url: `${APP}/api/auth/magic-link/verify?token=SAMPLE-TOKEN`,
    loginUrl: `${APP}/login`,
    confirmUrl: `${APP}/confirm?token=SAMPLE-TOKEN`,
  }
);

/** Fictional preview only: no account or Stripe read and no message is sent. */
export const getSampleEmailVars = (
  templateId: string,
  locale: LocaleType
): Record<string, string> => ({
  ...BASE_SAMPLE_VARS,
  ...(templateId === 'renewal-reminder'
    ? {
        renewalAmount: formatEmailCurrency(12300, 'pln', locale) ?? '',
        renewalDate: new Intl.DateTimeFormat(locale, {
          dateStyle: 'long',
        }).format(new Date(2030, 0, 15, 12)),
      }
    : {}),
});
