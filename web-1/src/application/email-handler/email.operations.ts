/**
 * Email Operations
 * Business-critical email operations (alerts, notifications).
 */

import { reportIssueBackend } from '@app/debugger/error-handler';
import { sendLifecycleEmail } from './email-transport';
import { getPrimaryAdminEmail } from '@app/admin/admin.utils.api';
import { type CriticalBusinessAlertParams } from './email.types';
import { CRITICAL_ALERT_EMAIL_CONFIG } from './email.config';
import { escapeHtml, validateAlertParams } from './email.utils';

/**
 * Sends a critical business alert email to admin.
 *
 * Used for situations like:
 * - Payment received but planId missing in metadata
 * - Checkout completed but user cannot be upgraded
 * - Payment received but orphaned (no user found)
 *
 * This function validates input and logs errors but doesn't throw
 * to prevent blocking the main flow.
 */
export const sendCriticalBusinessAlert = async ({
  alertTitle,
  alertMessage,
  lines,
  link,
  details,
}: CriticalBusinessAlertParams): Promise<void> => {
  const adminEmail = getPrimaryAdminEmail();

  if (!adminEmail) {
    reportIssueBackend({
      namespace: 'CRITICAL_ALERT_NO_RECIPIENTS',
      message: 'Cannot send critical alert - no admin email configured',
      payload: { alertTitle, alertMessage, details },
      mode: 'error',
    });
    return;
  }

  // Validate and sanitize input
  let sanitized: ReturnType<typeof validateAlertParams>;
  try {
    sanitized = validateAlertParams({
      alertTitle,
      alertMessage,
      lines,
      link,
      details,
    });
  } catch (error) {
    reportIssueBackend({
      namespace: 'CRITICAL_ALERT_VALIDATION_ERROR',
      message: 'Invalid alert parameters',
      payload: { alertTitle, alertMessage, error },
      mode: 'error',
    });
    return;
  }

  const subject = `${CRITICAL_ALERT_EMAIL_CONFIG.subjectPrefix} ${sanitized.alertTitle}`;

  const detailsFormatted = JSON.stringify(sanitized.details, null, 2);
  const linesText =
    sanitized.lines.length > 0
      ? `\n${sanitized.lines.map(line => `• ${line}`).join('\n')}\n`
      : '';
  // SECURITY: every line is escaped; the list markup is ours.
  const linesHtml =
    sanitized.lines.length > 0
      ? CRITICAL_ALERT_EMAIL_CONFIG.linesHtmlTemplate.replace('{{items}}', () =>
          sanitized.lines
            .map(line =>
              CRITICAL_ALERT_EMAIL_CONFIG.lineHtmlTemplate.replace(
                '{{line}}',
                () => escapeHtml(line)
              )
            )
            .join('')
        )
      : '';

  const alertLink = sanitized.link;
  const linkText = alertLink ? `\n${alertLink.label}: ${alertLink.url}\n` : '';
  const linkHtml = alertLink
    ? CRITICAL_ALERT_EMAIL_CONFIG.linkHtmlTemplate
        .replace('{{url}}', () => escapeHtml(alertLink.url))
        .replace('{{label}}', () => escapeHtml(alertLink.label))
    : '';

  // Function replacers: a `$` in the data must not act as a replace pattern.
  const text = CRITICAL_ALERT_EMAIL_CONFIG.textTemplate
    .replace(/\{\{alertTitle\}\}/g, () => sanitized.alertTitle)
    .replace(/\{\{alertMessage\}\}/g, () => sanitized.alertMessage)
    .replace(/\{\{lines\}\}/g, () => linesText)
    .replace(/\{\{link\}\}/g, () => linkText)
    .replace(/\{\{details\}\}/g, () => detailsFormatted);

  // SECURITY: escapeHtml on details — JSON.stringify does NOT escape HTML entities
  const html = CRITICAL_ALERT_EMAIL_CONFIG.htmlTemplate
    .replace(/\{\{alertTitle\}\}/g, () => escapeHtml(sanitized.alertTitle))
    .replace(/\{\{alertMessage\}\}/g, () => escapeHtml(sanitized.alertMessage))
    .replace(/\{\{linesHtml\}\}/g, () => linesHtml)
    .replace(/\{\{linkHtml\}\}/g, () => linkHtml)
    .replace(/\{\{details\}\}/g, () => escapeHtml(detailsFormatted));

  const sent = await sendLifecycleEmail({
    to: adminEmail,
    subject,
    text,
    html,
    templateId: 'critical-alert',
    tags: ['critical-alert', 'stripe'],
    headers: {},
  });

  if (sent) {
    reportIssueBackend({
      namespace: 'CRITICAL_ALERT_SENT',
      message: 'Critical business alert sent successfully',
      payload: { to: adminEmail, alertTitle: sanitized.alertTitle },
      mode: 'info',
    });
  }
};
