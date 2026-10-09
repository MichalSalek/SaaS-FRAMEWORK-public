/**
 * Email Transport — Lifecycle email sending with fallback
 *
 * SRP: Send lifecycle emails via Resend (primary, when RESEND_API_KEY set) →
 * Mailgun (fallback; primary if Resend absent) → SMTP (final fallback).
 * Fire-and-forget — one failed email does not block the sweep.
 *
 * Pattern: based on existing email.operations.ts (sendCriticalBusinessAlert)
 *
 * Circuit breaker integration:
 *   Before each send, `canSendEmail(category)` is checked. In OPEN state,
 *   only TRANSACTIONAL emails pass. All others are suppressed + logged.
 *   The circuit breaker cache is refreshed here non-blocking (1h TTL) via
 *   `triggerBounceRateRefresh()`, so high-volume sweeps drive the polling
 *   cadence without extra infrastructure and without adding poll latency to
 *   the send path.
 */

import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { ENV_VARS } from '@app/environment/environment.config';
import { sendEmail as sendViaMailgun } from './adapters/mailgun';
import { sendEmail as sendViaResend } from './adapters/resend';
import { sendEmailViaSmtp } from './adapters/smtp';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { resolveSystemActorId_IO } from '@app/event-log/system-actor';
import { DB_CLIENT } from '@app/db/db.client';
import {
  canSendEmail,
  shouldLogSuppressedSend,
  triggerBounceRateRefresh,
} from './email-circuit-breaker';
import type { EmailCategory } from '@kernel/domain/email/email-schedule.config';

type LifecycleEmailParams = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Explicit template identifier persisted in the FailedEmail dead-letter row.
   * Use the body template id (e.g. 'trial-winback') or a stable ad-hoc id for
   * non-templated sends (e.g. 'contact-form', 'critical-alert').
   */
  templateId: string;
  tags: string[];
  headers: Record<string, string>;
  /**
   * Email category — required for circuit-breaker gating.
   * If omitted, defaults to TRANSACTIONAL (always passes).
   */
  category?: EmailCategory;
  /**
   * Dead-letter ownership flag (default: true).
   *
   * true  — this call is the FINAL delivery attempt for the incident: on
   *         both-transports failure, write exactly 1 FailedEmail row + 1 durable
   *         EMAIL_SEND_FAILED event (single-attempt callers keep this default).
   * false — a retry wrapper (or an outer layer like email-transactional.ts) owns
   *         the incident: log lightly and return false WITHOUT a FailedEmail row,
   *         so N retries produce 1 dead-letter, not N.
   */
  deadLetterOnFailure?: boolean;
};

/**
 * Send a lifecycle email with Resend → Mailgun → SMTP fallback chain.
 *
 * DOES NOT throw — errors are logged via reportIssueBackend + EventLog.
 * This ensures one failed email doesn't block the entire sweep.
 *
 * Circuit breaker: if bounce rate ≥ 5% and category is non-critical,
 * the email is suppressed (returns false, no retry, no dead-letter write).
 * Callers receive false — same contract as a failed send.
 *
 * @returns true if email was sent successfully (via either transport),
 *          false if blocked (circuit OPEN) or both transports failed.
 */
export const sendLifecycleEmail = async (
  params: LifecycleEmailParams
): Promise<boolean> => {
  if (!params.to || !params.to.includes('@')) {
    reportIssueBackend({
      namespace: 'EMAIL_INVALID_RECIPIENT',
      message: `Invalid email address: "${params.to}"`,
      payload: { to: params.to, subject: params.subject },
      mode: 'error',
    });
    return false;
  }

  // ── Circuit breaker check ─────────────────────────────────────────────────
  // Trigger a cache refresh WITHOUT awaiting it: this send decides on the
  // currently-cached state, and the fresh poll (if cache is stale) lands for
  // subsequent sends. Awaiting would put Mailgun-poll latency on the critical
  // path — up to ~6s — which on user-facing sends that 500 on failure (contact
  // form, account-delete-self, support) risks a serverless timeout. Safe
  // because the 24h-window bounce rate does not move within a single request;
  // a stale-but-recent reading is fine. Cold cache → CLOSED (fail-open: a new
  // instance accepts the send rather than blocking on a poll). The send-driven
  // polling cadence (one poll per TTL) is preserved.
  triggerBounceRateRefresh();

  const category: EmailCategory = params.category ?? 'TRANSACTIONAL';
  if (!canSendEmail(category)) {
    // Gate the durable audit row + warn report to ONCE per OPEN episode: a sweep
    // of N suppressed non-critical emails would otherwise write N audit rows + N
    // reports (mirrors the OPEN-transition dedup and the daily-limit trip log).
    // The email is still suppressed on every call — only the logging is deduped.
    if (shouldLogSuppressedSend()) {
      reportIssueBackend({
        namespace: 'EMAIL_CIRCUIT_BREAKER_BLOCKED',
        message: `Email suppressed by circuit breaker (OPEN state). Category: ${category}`,
        payload: { to: params.to, subject: params.subject, category },
        mode: 'warn',
      });
      // Best-effort audit log (fire-and-forget, do not await)
      // DECISION (nie usuwaj tego komentarza):
      // writeRawEventLog_IO drops entries without created_by_user_id (loud generic report, no durable record) —
      // passing user:null is a pseudo-write. Loud report + skip instead (pattern:
      // admin-alerts.operation.ts daily digest).
      const systemActorId = await resolveSystemActorId_IO();
      if (systemActorId) {
        void recordAuditEvent_IO({
          eventName: APP_EVENTS.INFO.EMAIL.EMAIL_CIRCUIT_BREAKER_BLOCKED,
          user: { id: systemActorId },
          responseBody: { category, subject: params.subject },
        }).catch(() => {
          /* best-effort */
        });
      } else {
        reportIssueBackend({
          namespace: 'EMAIL_CIRCUIT_BREAKER_AUDIT_SKIPPED',
          message:
            'EMAIL_CIRCUIT_BREAKER_BLOCKED audit SKIPPED: system actor unavailable (no admin user seeded/configured) — EventLog entry would be dropped (no durable record)',
          payload: { category, subject: params.subject },
          mode: 'error',
        });
      }
    }
    return false;
  }

  // Primary: Resend (gdy RESEND_API_KEY obecny) — przed Mailgunem. Sukces kończy;
  // błąd (w tym 429 daily-cap) → spada na Mailgun.
  if (ENV_VARS.RESEND_API_KEY) {
    try {
      await sendViaResend({
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text,
        tags: params.tags,
        headers: params.headers,
      });
      return true;
    } catch (resendError) {
      reportIssueBackend({
        namespace: 'EMAIL_LIFECYCLE_RESEND_FAILED',
        message: 'Resend send failed, trying Mailgun fallback',
        payload: {
          to: params.to,
          subject: params.subject,
          error: resendError,
        },
        mode: 'warn',
      });
    }
  }

  try {
    // Mailgun API (primary gdy RESEND wyłączony, fallback gdy włączony)
    await sendViaMailgun({
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
      tags: params.tags,
      headers: params.headers,
    });
    return true;
  } catch (mailgunError) {
    reportIssueBackend({
      namespace: 'EMAIL_LIFECYCLE_MAILGUN_FAILED',
      message: 'Mailgun send failed, trying SMTP fallback',
      payload: {
        to: params.to,
        subject: params.subject,
        error: mailgunError,
      },
      mode: 'warn',
    });
  }

  try {
    // Fallback: SMTP (headers forwarded — keeps List-Unsubscribe on fallback path)
    await sendEmailViaSmtp({
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
      headers: params.headers,
    });
    return true;
  } catch (smtpError) {
    const deadLetterOnFailure = params.deadLetterOnFailure ?? true;

    // Both failed — log; durable dead-letter only on the final attempt
    reportIssueBackend({
      namespace: 'EMAIL_LIFECYCLE_SEND_FAILED',
      message: deadLetterOnFailure
        ? 'All email transports failed for lifecycle email (Resend/Mailgun/SMTP)'
        : 'All email transports failed for lifecycle email (non-final attempt, retry pending)',
      payload: {
        to: params.to,
        subject: params.subject,
        error: smtpError,
      },
      mode: deadLetterOnFailure ? 'error' : 'warn',
    });

    // Non-final attempt: the retry wrapper / outer layer owns the incident.
    // No FailedEmail row, no EMAIL_SEND_FAILED event — exactly 1 dead-letter
    // per incident is written by whoever sets deadLetterOnFailure=true.
    if (!deadLetterOnFailure) {
      return false;
    }

    // DECISION (nie usuwaj tego komentarza):
    // Await both writes so audit trail is durable before caller sees false return.
    // Otherwise process death between send-failure and DB-commit would silently lose
    // the only record of the failed email. Matches pattern in email-transactional.ts:175-205.
    // DECISION (nie usuwaj tego komentarza):
    // writeRawEventLog_IO drops entries without created_by_user_id (loud generic report, no durable record) —
    // passing user:null would be a pseudo-write losing the durable
    // EMAIL_SEND_FAILED record. Loud report + skip instead (pattern:
    // admin-alerts.operation.ts daily digest). The FailedEmail dead-letter row
    // below is still written regardless.
    const systemActorId = await resolveSystemActorId_IO();
    if (systemActorId) {
      await recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.EMAIL.EMAIL_SEND_FAILED,
        user: { id: systemActorId },
        responseBody: {
          to: params.to,
          subject: params.subject,
          reason: 'All email transports failed (Resend/Mailgun/SMTP)',
        },
      }).catch(auditError => {
        reportIssueBackend({
          namespace: 'EMAIL_LIFECYCLE_AUDIT_FAILED',
          message: 'Failed to record lifecycle audit event',
          payload: { to: params.to, error: auditError },
          mode: 'error',
        });
      });
    } else {
      reportIssueBackend({
        namespace: 'EMAIL_LIFECYCLE_AUDIT_SKIPPED',
        message:
          'EMAIL_SEND_FAILED audit SKIPPED: system actor unavailable (no admin user seeded/configured) — durable EventLog entry would be dropped',
        payload: { to: params.to, subject: params.subject },
        mode: 'error',
      });
    }

    await DB_CLIENT.use.failedEmail
      .create({
        data: {
          recipient: params.to,
          template: params.templateId,
          subject: params.subject,
          payload: {
            tags: params.tags,
            headers: params.headers,
          },
          error:
            smtpError instanceof Error ? smtpError.message : String(smtpError),
          // Liczba realnie podjętych transportów: Resend (gdy klucz obecny) + Mailgun + SMTP = 3,
          // albo Mailgun + SMTP = 2 gdy Resend wyłączony. Stałe „2" zaniżało audyt po dodaniu Resend.
          attempts: ENV_VARS.RESEND_API_KEY ? 3 : 2,
        },
      })
      .catch(deadLetterError => {
        reportIssueBackend({
          namespace: 'EMAIL_LIFECYCLE_DEAD_LETTER_FAILED',
          message: 'Failed to write lifecycle email to dead-letter table',
          payload: { to: params.to, error: deadLetterError },
          mode: 'error',
        });
      });

    return false;
  }
};
