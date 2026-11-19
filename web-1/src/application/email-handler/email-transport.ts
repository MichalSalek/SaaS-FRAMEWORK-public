/**
 * Email Transport: lifecycle email sending with fallback.
 *
 * SRP: send lifecycle emails via Resend (primary, when RESEND_API_KEY set) -> Mailgun (fallback;
 * primary if Resend is absent) -> SMTP (final fallback). Fire-and-forget: one failed email does not
 * block the sweep. Pattern: based on email.operations.ts (sendCriticalBusinessAlert).
 *
 * Circuit breaker: before each send `canSendEmail(category)` is checked. In OPEN state only
 * TRANSACTIONAL emails pass; all others are suppressed and logged. The breaker cache is refreshed
 * here non-blocking (1h TTL) via `triggerBounceRateRefresh()`, so high-volume sweeps drive the
 * polling cadence without adding poll latency to the send path.
 */

import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { resolveSystemActorId_IO } from '@app/event-log/system-actor';
import { ENV_VARS } from '@app/environment/environment.config';
import { sendEmail as sendViaMailgun } from './adapters/mailgun';
import {
  isStagingMailpit,
  sendStagingMailpit,
} from './adapters/staging-mailpit';
import { reportTransportFailure } from './staging-mailpit-failure';
import { sendEmail as sendViaResend } from './adapters/resend';
import { isSmtpConfigured, sendEmailViaSmtp } from './adapters/smtp';
import { reportIssueBackend } from '@app/debugger/error-handler';
import {
  canSendEmail,
  shouldLogSuppressedSend,
  triggerBounceRateRefresh,
} from './email-circuit-breaker';
import type { EmailCategory } from '@kernel/domain/email/email-schedule.config';
import { isPrechargeReminderDisabled } from '@app/email-handler/email-precharge-reminder.policy';

// Measured/outbox delivery uses the same staging transport through this facade.
export { isStagingMailpit, sendStagingMailpit };

export type LifecycleEmailParams = {
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
  if (isPrechargeReminderDisabled(params.templateId)) {
    return false;
  }
  if (!params.to || !params.to.includes('@')) {
    reportIssueBackend({
      namespace: 'EMAIL_INVALID_RECIPIENT',
      message: `Invalid email address: "${params.to}"`,
      payload: { to: params.to, subject: params.subject },
      mode: 'error',
    });
    return false;
  }

  // Staging never enters the provider chain or the external bounce-rate poll.
  if (isStagingMailpit()) {
    try {
      await sendStagingMailpit(params);
      return true;
    } catch (error) {
      return reportTransportFailure(params, error, 1, 'Mailpit');
    }
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
      // DECISION: see the dead-letter branch below (no system actor means no audit row).
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
    // Mailgun API (primary when RESEND is disabled, fallback when enabled)
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

  const smtpEnabled = isSmtpConfigured();
  try {
    if (!smtpEnabled) {
      throw new Error('Optional SMTP fallback is not configured');
    }
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
    return reportTransportFailure(
      params,
      smtpError,
      (ENV_VARS.RESEND_API_KEY ? 2 : 1) + (smtpEnabled ? 1 : 0),
      'Resend/Mailgun/SMTP'
    );
  }
};
