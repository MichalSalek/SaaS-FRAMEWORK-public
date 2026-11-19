/**
 * Transactional Email Helper
 *
 * Triggered by business events (signup, upgrade, downgrade, pairing, payment failure). NOT sent via
 * the sweep interceptor: called directly from handlers/operations after a successful business event.
 *
 * - Never throws: catches errors and returns false (true on success; callers decide whether to act)
 * - Retry: RETRY.EMAIL_MAX_ATTEMPTS (2, i.e. 1 retry, ~1s backoff) before giving up (kept low:
 *   Mailgun free counts requests against a hard daily cap; see constants.config)
 * - Dead-letter: failed emails go to the FailedEmail table for audit/manual resend
 * - EventLog push for tracking/dedup
 * - Transactional emails have no unsubscribe link
 */

import type { LocaleType } from '@kernel/domain/i18n/i18n.config';
import type { EVENT_INFO_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { renderEmailTemplate } from './email-template.renderer';
import { resolveLocaleByEmail } from './email-locale.resolver';
import { sendLifecycleEmail } from './email-transport';
import {
  withEmailDeliveryRetry,
  RETRY_MAX_ATTEMPTS,
} from './email-retry.utils';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { isPrechargeReminderDisabled } from '@app/email-handler/email-precharge-reminder.policy';
import { DB_CLIENT } from '@app/db/db.client';
import type { Prisma } from '../../prisma/js-client';

// ── Dedup guard (in-memory, 60s window) ───────────────────────────────

const DEDUP_WINDOW_MS = 60_000;
const recentSends = new Map<string, number>();

/**
 * Build the dedup key from the FULL email payload, not just email + template.
 *
 * DECISION: the dedup window suppresses identical double-fires (double-click, retry, duplicate
 * webhook), so it keys on actual CONTENT (recipient + template + vars), not `email:templateId`.
 * Some mails rotate a per-call token inside `vars` ('newsletter-confirm', 'email-change-confirm'
 * carry a fresh `confirmUrl`); a coarse key would swallow a legitimate re-send and leave the user
 * with an old, invalidated link (NEWSLETTER_INVALID_TOKEN). Stable payloads still dedupe, a
 * rotated token gets a new key. `vars` is small and developer-controlled, so JSON.stringify is
 * enough.
 */
const buildDedupKey = (
  email: string,
  templateId: string,
  vars?: Record<string, string>
): string => {
  const varsFingerprint =
    vars && Object.keys(vars).length > 0 ? JSON.stringify(vars) : '';
  return `${email}:${templateId}:${varsFingerprint}`;
};

const isDuplicate = (key: string): boolean => {
  const lastSent = recentSends.get(key);
  return Boolean(lastSent && Date.now() - lastSent < DEDUP_WINDOW_MS);
};

const markSent = (key: string): void => {
  recentSends.set(key, Date.now());
  if (recentSends.size > 500) {
    const cutoff = Date.now() - DEDUP_WINDOW_MS;
    for (const [k, ts] of recentSends) {
      if (ts < cutoff) {
        recentSends.delete(k);
      }
    }
  }
};

// ── Retry infrastructure ─────────────────────────────────────────────────────
// Retry helper lives in email-retry.utils.ts so lifecycle sweep can reuse it.

// ── Dead-letter persistence ──────────────────────────────────────────────────

type DeadLetterPayload = {
  recipient: string;
  template: string;
  subject: string;
  payload: Prisma.InputJsonValue;
  error: string;
  attempts: number;
};

const writeToDeadLetter = async (entry: DeadLetterPayload): Promise<void> => {
  try {
    await DB_CLIENT.use.failedEmail.create({
      data: {
        recipient: entry.recipient,
        template: entry.template,
        subject: entry.subject,
        payload: entry.payload,
        error: entry.error,
        attempts: entry.attempts,
      },
    });
  } catch (dbError) {
    // If DB write fails, log but don't propagate — we already logged the email failure
    reportIssueBackend({
      namespace: 'EMAIL_DEAD_LETTER_WRITE_FAILED',
      message: 'Failed to write dead-letter record',
      payload: { entry, dbError },
      mode: 'error',
    });
  }
};

// ── Main function ────────────────────────────────────────────────────────────

/**
 * Sends one transactional mail. Retries `RETRY.EMAIL_MAX_ATTEMPTS` times (one retry,
 * about 1s) so a user-facing request stays under the serverless timeout. After that,
 * writes FailedEmail and emits EMAIL_DEAD_LETTERED. Service mail cannot be unsubscribed:
 * no List-Unsubscribe header and an empty footer URL. An explicit locale wins; otherwise
 * resolveLocaleByEmail picks one and fails open to pl.
 */
export const sendTransactionalEmail = async (
  templateId: string,
  user: { email: string; name?: string | null; id?: string },
  infoEvent: EVENT_INFO_TYPE,
  vars?: Record<string, string>,
  subjectKey?: string,
  locale?: LocaleType
): Promise<boolean> => {
  if (isPrechargeReminderDisabled(templateId)) {
    return false;
  }
  const dedupKey = buildDedupKey(user.email, templateId, vars);
  if (isDuplicate(dedupKey)) {
    reportIssueBackend({
      namespace: 'EMAIL_TRANSACTIONAL_DEDUP',
      message: `Duplicate email suppressed within ${DEDUP_WINDOW_MS}ms window`,
      payload: { email: user.email, templateId },
      mode: 'info',
    });
    return true;
  }

  try {
    // Explicit locale from caller wins; otherwise resolve the recipient's
    // preferred language (fail-open to 'pl', never throws — 2 indexed queries).
    const resolvedLocale = locale ?? (await resolveLocaleByEmail(user.email));
    const unsubscribeUrl = ''; // transactional = no unsubscribe
    const { subject, html, text } = renderEmailTemplate(
      templateId,
      {
        displayName: user.name || '',
        ...vars,
      },
      resolvedLocale,
      unsubscribeUrl,
      subjectKey
    );

    // Retry loop: sendLifecycleEmail returns false on failure (never throws).
    // deadLetterOnFailure stays false on EVERY attempt — this layer owns the
    // incident dead-letter (FailedEmail + EMAIL_DEAD_LETTERED below), so the
    // transport must not write a second FailedEmail row on the final attempt.
    const sent = await withEmailDeliveryRetry(() =>
      sendLifecycleEmail({
        to: user.email,
        subject,
        html,
        text,
        templateId,
        category: 'TRANSACTIONAL', // always passes circuit breaker — critical send
        tags: [templateId, 'transactional'],
        headers: {}, // no List-Unsubscribe for transactional
        deadLetterOnFailure: false,
      })
    );

    if (sent) {
      markSent(dedupKey);
      await recordAuditEvent_IO({
        eventName: infoEvent,
        user: user.id ? { id: user.id } : { email: user.email },

        responseBody: {
          templateId,
        },
      });
      return true;
    }

    // All retries exhausted — dead-letter. Await both writes so audit trail is durable
    // before caller sees the false return; otherwise process death between send-failure
    // and DB-commit would silently lose the only record of the lost email.
    const deadLetterPayload: Prisma.InputJsonObject = {
      templateId,
      userId: user.id ?? null,
      userName: user.name ?? null,
      vars: vars ?? null,
      subjectKey: subjectKey ?? null,
      locale: resolvedLocale,
    };
    await writeToDeadLetter({
      recipient: user.email,
      template: templateId,
      subject,
      payload: deadLetterPayload,
      error: `All ${RETRY_MAX_ATTEMPTS} send attempts failed (Mailgun + SMTP fallback)`,
      attempts: RETRY_MAX_ATTEMPTS,
    });

    await recordAuditEvent_IO({
      eventName: APP_EVENTS.INFO.EMAIL.EMAIL_DEAD_LETTERED,
      user: user.id ? { id: user.id } : { email: user.email },
      // PII (the address) stays out of the audit log: the full recipient lives in FailedEmail
      // (writeToDeadLetter above, an operational table for resend), not in the 90d event log.
      // `to` is omitted as on the success path: the redactor catches it today, but the field is
      // redundant next to `user.id` anyway.
      responseBody: {
        templateId,
        attempts: RETRY_MAX_ATTEMPTS,
        reason: 'All retry attempts exhausted',
      },
    });

    reportIssueBackend({
      namespace: 'EMAIL_TRANSACTIONAL_DEAD_LETTERED',
      message: `Transactional email dead-lettered after ${RETRY_MAX_ATTEMPTS} attempts: ${templateId}`,
      payload: { email: user.email, templateId },
      mode: 'error',
    });

    return false;
  } catch (error) {
    // Template rendering or unexpected error — no retry (broken template won't fix itself)
    reportIssueBackend({
      namespace: 'EMAIL_TRANSACTIONAL_FAILED',
      message: `Failed to send transactional email: ${templateId}`,
      payload: { email: user.email, templateId, error },
      mode: 'error',
    });
    return false;
  }
};
