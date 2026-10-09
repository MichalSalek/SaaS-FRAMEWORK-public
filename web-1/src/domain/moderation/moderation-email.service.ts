/**
 * Content Moderation — Email Service
 *
 * Sends notification emails for content moderation events:
 * 1. Admin alert when new content report is submitted
 * 2. Photo owner notification when moderation action is taken
 *
 * SLA: 48h (business days) — as per CONTENT_MODERATION_POLICY.md
 */

import { resolveLocaleByEmail } from '@app/email-handler/email-locale.resolver';
import { sendLifecycleEmail } from '@app/email-handler/email-transport';
import { renderEmailTemplate } from '@app/email-handler/email-template.renderer';
import { buildFrontendBaseUrl } from '@app/environment/environment.utils.api';
import { getPrimaryAdminEmail } from '@app/admin/admin.utils.api';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { escapeHtml } from '@app/email-handler/email.utils';
import type {
  ContentReportReason,
  ModerationAction,
} from '@kernel/models/moderation/moderation.dto';
import { RETRY } from '@kernel/application/constants.config';

// Bounded retry for moderation emails — owner notifications are RODO/DSA-relevant
// (user must be informed about moderation decisions). Lifecycle transport is single-attempt;
// wrap here for delivery resilience without pulling in the full transactional pipeline.
// MAX_ATTEMPTS=2 jest celowo niższe niż kanoniczny RETRY.MAX_ATTEMPTS (1 retry wystarcza
// dla single-flap), ale base delay = ten sam kanon co reszta retry-loopów.
const MODERATION_EMAIL_MAX_ATTEMPTS = 2;
const MODERATION_EMAIL_RETRY_DELAY_MS = RETRY.BASE_DELAY_MS;

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

type LifecycleEmailParams = Parameters<typeof sendLifecycleEmail>[0];

const sendModerationEmailWithRetry = async (
  email: LifecycleEmailParams
): Promise<boolean> => {
  for (let attempt = 1; attempt <= MODERATION_EMAIL_MAX_ATTEMPTS; attempt++) {
    // Dead-letter exactly once per incident: only the final attempt may write
    // the FailedEmail row + EMAIL_SEND_FAILED event in the transport.
    const sent = await sendLifecycleEmail({
      ...email,
      deadLetterOnFailure: attempt === MODERATION_EMAIL_MAX_ATTEMPTS,
    });
    if (sent) {
      return true;
    }
    if (attempt < MODERATION_EMAIL_MAX_ATTEMPTS) {
      await sleep(MODERATION_EMAIL_RETRY_DELAY_MS);
    }
  }
  return false;
};

// ── Admin Alert: New Content Report ──

type ContentReportAlertParams = {
  reportId: string;
  galleryRecordId: string;
  reason: ContentReportReason;
  reporterEmail: string;
  description?: string | undefined;
};

export const sendContentReportAdminAlert = async (
  params: ContentReportAlertParams
): Promise<void> => {
  const adminEmail = getPrimaryAdminEmail();

  if (!adminEmail) {
    reportIssueBackend({
      namespace: 'MODERATION_ALERT_NO_ADMIN',
      message: 'Cannot send content report alert — no admin email configured',
      payload: params,
      mode: 'warn',
    });
    return;
  }

  const reasonLabels: Record<ContentReportReason, string> = {
    INAPPROPRIATE: 'Nieodpowiednie treści',
    FACE: 'Wizerunek osoby (twarz)',
    SPAM: 'Spam / reklama',
    OTHER: 'Inne',
  };

  const reasonLabel = reasonLabels[params.reason] || params.reason;
  const descriptionText = params.description
    ? `\nOpis: ${params.description}`
    : '';

  const subject = `[Moderation] Nowe zgłoszenie treści: ${reasonLabel}`;

  const text = `NOWE ZGŁOSZENIE TREŚCI

Zgłoszenie ID: ${params.reportId}
Zdjęcie ID: ${params.galleryRecordId}
Powód: ${reasonLabel}${descriptionText}
Zgłaszający: ${params.reporterEmail}

SLA: Rozpatrz w ciągu 48h (dni robocze).

---
Automatyczne powiadomienie z systemu moderacji.`;

  const html = `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nowe zgłoszenie treści</title>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background-color:#FEF9C3;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FEF9C3;">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border-radius:12px;border:1px solid #CA8A04;">
          <tr>
            <td style="padding:24px 40px;text-align:center;border-bottom:1px solid #FEF08A;background-color:#FEF9C3;border-radius:12px 12px 0 0;">
              <span style="font-size:14px;font-weight:600;color:#CA8A04;">Nowe zgłoszenie treści</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:8px 0;font-size:14px;color:#374151;">
                    <strong>Zgłoszenie ID:</strong> ${escapeHtml(params.reportId)}
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;font-size:14px;color:#374151;">
                    <strong>Zdjęcie ID:</strong> ${escapeHtml(params.galleryRecordId)}
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0;font-size:14px;color:#374151;">
                    <strong>Powód:</strong> ${escapeHtml(reasonLabel)}
                  </td>
                </tr>
                ${
                  params.description
                    ? `<tr>
                  <td style="padding:8px 0;font-size:14px;color:#374151;">
                    <strong>Opis:</strong> ${escapeHtml(params.description)}
                  </td>
                </tr>`
                    : ''
                }
                <tr>
                  <td style="padding:8px 0;font-size:14px;color:#374151;">
                    <strong>Zgłaszający:</strong> ${escapeHtml(params.reporterEmail)}
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;background-color:#FEF9C3;border-radius:6px;border:1px solid #FEF08A;">
                <tr>
                  <td style="padding:12px 16px;font-size:14px;color:#854D0E;">
                    <strong>SLA:</strong> Rozpatrz w ciągu 48h (dni robocze).
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 40px;border-top:1px solid #FEF08A;text-align:center;background-color:#FEF9C3;border-radius:0 0 12px 12px;">
              <p style="font-size:14px;line-height:21px;color:#854D0E;margin:0;">
                Automatyczne powiadomienie z systemu moderacji.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const sent = await sendModerationEmailWithRetry({
    to: adminEmail,
    subject,
    text,
    html,
    templateId: 'moderation-content-report',
    tags: ['moderation', 'content-report'],
    headers: {},
  });

  if (sent) {
    reportIssueBackend({
      namespace: 'MODERATION_ALERT_SENT',
      message: `Content report admin alert sent for report ${params.reportId}`,
      payload: { to: adminEmail, reportId: params.reportId },
      mode: 'info',
    });
  } else {
    reportIssueBackend({
      namespace: 'MODERATION_ALERT_DELIVERY_LOST',
      message: `Content report admin alert FAILED after ${MODERATION_EMAIL_MAX_ATTEMPTS} attempts for report ${params.reportId}`,
      payload: { to: adminEmail, reportId: params.reportId },
      mode: 'error',
    });
  }
};

// ── Owner Notification: Moderation Action Taken ──

type ModerationActionOwnerEmailParams = {
  ownerEmail: string;
  action: ModerationAction;
  galleryRecordId: string | null;
  adminNote?: string | undefined;
};

const ownerSubjectKey = (action: ModerationAction): string | null => {
  switch (action) {
    case 'HIDE':
      return 'email.moderation.hide.subject';
    case 'DELETE':
      return 'email.moderation.delete.subject';
    case 'WARN':
      return 'email.moderation.warn.subject';
    case 'BAN':
      return 'email.moderation.ban.subject';
    case 'DISMISS':
      return null;
  }
};

export const sendModerationActionOwnerEmail = async (
  params: ModerationActionOwnerEmailParams
): Promise<void> => {
  const subjectKey = ownerSubjectKey(params.action);
  if (subjectKey === null) {
    return;
  }
  const recordIdLabel = params.galleryRecordId ?? 'usuniete';
  // Język odbiorcy (fail-open → pl), nie sztywne pl: klucze pl/en/de istnieją.
  const locale = await resolveLocaleByEmail(params.ownerEmail);
  const rendered = renderEmailTemplate(
    'moderation-owner-notification',
    {
      moderationAction: params.action,
      galleryRecordId: recordIdLabel,
      ...(params.adminNote ? { adminNote: params.adminNote } : {}),
      appUrl: buildFrontendBaseUrl(),
    },
    locale,
    '',
    subjectKey
  );

  const sent = await sendModerationEmailWithRetry({
    to: params.ownerEmail,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    templateId: 'moderation-owner-notification',
    tags: ['moderation', 'owner-notification'],
    headers: {},
  });

  if (sent) {
    reportIssueBackend({
      namespace: 'MODERATION_OWNER_EMAIL_SENT',
      message: `Moderation action notification sent to ${params.ownerEmail} for record ${recordIdLabel}`,
      payload: { to: params.ownerEmail, action: params.action },
      mode: 'info',
    });
  } else {
    reportIssueBackend({
      namespace: 'MODERATION_OWNER_EMAIL_DELIVERY_LOST',
      message: `Moderation owner notification FAILED after ${MODERATION_EMAIL_MAX_ATTEMPTS} attempts for record ${recordIdLabel}`,
      payload: { to: params.ownerEmail, action: params.action },
      mode: 'error',
    });
  }
};
