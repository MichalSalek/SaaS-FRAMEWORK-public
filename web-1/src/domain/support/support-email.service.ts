/**
 * Support Messaging — Email Notifications
 *
 * 1. Admin alert: new thread created
 * 2. Admin alert: new message in existing thread
 * 3. User notification: support replied to your thread
 */

import { resolveLocaleByEmail } from '@app/email-handler/email-locale.resolver';
import { sendLifecycleEmail } from '@app/email-handler/email-transport';
import { renderEmailTemplate } from '@app/email-handler/email-template.renderer';
import { buildFrontendBaseUrl } from '@app/environment/environment.utils.api';
import { getPrimaryAdminEmail } from '@app/admin/admin.utils.api';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { escapeHtml } from '@app/email-handler/email.utils';
import type { SupportThreadCategory } from '@kernel/models/support/support.dto';

// Admin alert mails are Polish (the admin reads them, not the user), so the
// category label is a local map and not an i18n key. `satisfies` makes a new
// enum value a compile error here instead of an "undefined" in the mail.
const SUPPORT_CATEGORY_LABEL_PL = {
  QUESTION: 'Pytanie',
  BILLING: 'Płatności i plan',
  BUG: 'Błąd w aplikacji',
  IDEA: 'Pomysł na funkcję',
  ACCOUNT: 'Konto i logowanie',
  OTHER: 'Inne',
} as const satisfies Record<SupportThreadCategory, string>;

// ── Admin Alert: New Thread ──

type NewThreadAlertParams = {
  threadId: string;
  subject: string;
  category: SupportThreadCategory;
  firstMessage: string;
  userEmail: string;
};

export const sendSupportNewThreadAdminAlert = async (
  params: NewThreadAlertParams
): Promise<void> => {
  const adminEmail = getPrimaryAdminEmail();

  if (!adminEmail) {
    reportIssueBackend({
      namespace: 'SUPPORT_ALERT_NO_ADMIN',
      message: 'Cannot send support thread alert — no admin email configured',
      payload: params,
      mode: 'warn',
    });
    return;
  }

  const categoryLabel = SUPPORT_CATEGORY_LABEL_PL[params.category];
  const subject = `[Support] ${categoryLabel}: ${params.subject}`;

  const text = `NOWY WĄTEK SUPPORTU

Wątek ID: ${params.threadId}
Kategoria: ${categoryLabel}
Temat: ${params.subject}
Użytkownik: ${params.userEmail}

Wiadomość:
${params.firstMessage}

---
Automatyczne powiadomienie z supportu.`;

  const html = `<!DOCTYPE html>
<html lang="pl">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background-color:#EFF6FF;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#EFF6FF;">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border-radius:12px;border:1px solid #2563EB;">
          <tr>
            <td style="padding:24px 40px;text-align:center;border-bottom:1px solid #DBEAFE;background-color:#EFF6FF;border-radius:12px 12px 0 0;">
              <span style="font-size:14px;font-weight:600;color:#1D4ED8;">Nowy wątek supportu</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr><td style="padding:8px 0;font-size:14px;color:#374151;"><strong>Kategoria:</strong> ${escapeHtml(categoryLabel)}</td></tr>
                <tr><td style="padding:8px 0;font-size:14px;color:#374151;"><strong>Temat:</strong> ${escapeHtml(params.subject)}</td></tr>
                <tr><td style="padding:8px 0;font-size:14px;color:#374151;"><strong>Użytkownik:</strong> ${escapeHtml(params.userEmail)}</td></tr>
                <tr><td style="padding:8px 0;font-size:14px;color:#374151;"><strong>Wątek ID:</strong> ${escapeHtml(params.threadId)}</td></tr>
                <tr><td style="padding:16px 0 8px;font-size:14px;color:#374151;"><strong>Wiadomość:</strong></td></tr>
                <tr><td style="padding:8px 16px;font-size:14px;color:#374151;background-color:#F9FAFB;border-radius:6px;white-space:pre-wrap;">${escapeHtml(params.firstMessage)}</td></tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 40px;border-top:1px solid #DBEAFE;text-align:center;background-color:#EFF6FF;border-radius:0 0 12px 12px;">
              <p style="font-size:14px;line-height:21px;color:#1D4ED8;margin:0;">Automatyczne powiadomienie z supportu.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  await sendLifecycleEmail({
    to: adminEmail,
    subject,
    text,
    html,
    templateId: 'support-new-thread',
    tags: ['support', 'new-thread'],
    headers: { 'Reply-To': params.userEmail },
  });
};

// ── Admin Alert: New Message in Existing Thread ──

type NewMessageAlertParams = {
  threadId: string;
  subject: string;
  message: string;
  userEmail: string;
};

export const sendSupportNewMessageAdminAlert = async (
  params: NewMessageAlertParams
): Promise<void> => {
  const adminEmail = getPrimaryAdminEmail();

  if (!adminEmail) {
    reportIssueBackend({
      namespace: 'SUPPORT_MSG_ALERT_NO_ADMIN',
      message: 'Cannot send support message alert — no admin email configured',
      payload: params,
      mode: 'warn',
    });
    return;
  }

  const subject = `[Support] Nowa wiadomość w: ${params.subject}`;

  const text = `NOWA WIADOMOŚĆ W WĄTKU SUPPORTU

Wątek ID: ${params.threadId}
Temat: ${params.subject}
Użytkownik: ${params.userEmail}

Wiadomość:
${params.message}

---
Automatyczne powiadomienie z supportu.`;

  await sendLifecycleEmail({
    to: adminEmail,
    subject,
    text,
    html: `<p><strong>Nowa wiadomość w wątku:</strong> ${escapeHtml(params.subject)}</p>
<p><strong>Użytkownik:</strong> ${escapeHtml(params.userEmail)}</p>
<p><strong>Wiadomość:</strong></p>
<blockquote style="padding:12px 16px;background:#F9FAFB;border:1px solid #DBEAFE;border-radius:6px;margin:16px 0;white-space:pre-wrap;">${escapeHtml(params.message)}</blockquote>`,
    templateId: 'support-new-message',
    tags: ['support', 'new-message'],
    headers: { 'Reply-To': params.userEmail },
  });
};

// ── User Notification: Support Replied ──

type SupportReplyNotificationParams = {
  threadId: string;
  subject: string;
  replyPreview: string;
  userEmail: string;
};

export const sendSupportReplyNotification = async (
  params: SupportReplyNotificationParams
): Promise<void> => {
  // Język odbiorcy (fail-open → pl), nie sztywne pl: klucze pl/en/de istnieją.
  const locale = await resolveLocaleByEmail(params.userEmail);
  const rendered = renderEmailTemplate(
    'support-reply-notification',
    {
      threadId: params.threadId,
      threadSubject: params.subject,
      replyPreview: params.replyPreview,
      appUrl: buildFrontendBaseUrl(),
    },
    locale,
    '',
    'email.support.reply.subject'
  );

  await sendLifecycleEmail({
    to: params.userEmail,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    templateId: 'support-reply-notification',
    tags: ['support', 'reply-notification'],
    headers: {},
  });
};
