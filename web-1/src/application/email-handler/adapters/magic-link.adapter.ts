import { ENV_VARS } from '@app/environment/environment.config';
import { IS_DEVELOPMENT_ENV } from '@app/environment/environment.utils.api';
import { resolveCanonicalFrontendOrigin } from '@app/auth/better-auth/auth-token-bridge';
import { sendEmail as sendViaMailgun } from './mailgun';
import { isStagingMailpit, sendStagingMailpit } from './staging-mailpit';
import { sendEmail as sendViaResend } from './resend';
import { isSmtpConfigured, sendEmailViaSmtp } from './smtp';
import { isMailgunDailyLimited } from '@app/email-handler/mailgun-daily-limit.breaker';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { DB_CLIENT } from '@app/db/db.client';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { resolveLocaleByEmail } from '@app/email-handler/email-locale.resolver';
import { renderEmailTemplate } from '@app/email-handler/email-template.renderer';
import { randomUUID } from 'node:crypto';

/**
 * Parameters for a magic-link verification request.
 *
 * Called by Better Auth's magic-link plugin — the shape matches the plugin's
 * `sendMagicLink` callback (email → identifier, url, token).
 */
export type MagicLinkRequestParams = {
  identifier: string;
  url: string;
  token: string;
};

// DECISION: 3 attempts, not the kernel RETRY.EMAIL_MAX_ATTEMPTS=2. Magic link is the only login
// path, so an undelivered mail locks the user out. When the Mailgun daily quota is exhausted the
// retry short-circuits through isMailgunDailyLimited() at zero quota cost, so the extra attempt
// only costs on a transient failure. Separate value on purpose; do not merge with the kernel one.
const MAGIC_LINK_MAX_ATTEMPTS = 3;
// DECISION: 500ms, not the kernel RETRY.BASE_DELAY_MS=1000. The send runs inside the login
// request's HTTP budget, so the backoff window is deliberately tighter. Do not merge.
const MAGIC_LINK_BASE_DELAY_MS = 500;

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

/**
 * Native deep-link (flag-gated): point the magic-link verify URL at the FRONTEND (associated)
 * origin instead of the backend, so a phone tap opens the native app via Universal Links (iOS) /
 * App Links (Android). The frontend proxies `/api/auth/*` back to the backend (main next.config
 * rewrite), so verify still runs server-side and the token bridge appends `?authCode` on that
 * same frontend origin.
 *
 * Uses the SAME resolveCanonicalFrontendOrigin() the bridge swaps to, so the e-mail's first-hop
 * host is byte-identical to the final authCode landing host.
 *
 * INERT until NATIVE_DEEPLINK_ENABLED; skipped in development (the dev magic-link already targets
 * the dev frontend via BETTER_AUTH_URL). Fail-open: a parse error keeps the original backend link
 * so a misconfig can never block the SOLE login path.
 */
const resolveMagicLinkUrl = (rawUrl: string): string => {
  if (!ENV_VARS.NATIVE_DEEPLINK_ENABLED || IS_DEVELOPMENT_ENV()) {
    return rawUrl;
  }
  try {
    const target = new URL(rawUrl);
    const frontend = new URL(resolveCanonicalFrontendOrigin());
    target.protocol = frontend.protocol;
    target.host = frontend.host;
    return target.toString();
  } catch {
    return rawUrl;
  }
};

// Locale resolution moved to the shared email-locale.resolver.ts (fail-open to pl;
// also reused by sendTransactionalEmail as the default when no locale is passed).

const trySendMagicLink = async ({
  identifier,
  subject,
  text,
  html,
  refId,
}: {
  identifier: string;
  subject: string;
  text: string;
  html: string;
  refId: string;
}): Promise<boolean> => {
  // X-Entity-Ref-ID: a unique per-mail id Gmail uses to SPLIT threads; without it successive
  // magic links (always the same subject) collapse into one thread and the user may click an
  // expired one. Generated ONCE in sendVerificationRequest and shared by all 3 fallback
  // transports AND all retries, since it is the same logical mail (at most one actually delivered).
  const headers = { 'X-Entity-Ref-ID': refId };
  if (isStagingMailpit()) {
    try {
      await sendStagingMailpit({
        to: identifier,
        subject,
        text,
        html,
        headers,
      });
      return true;
    } catch (error) {
      reportIssueBackend({
        namespace: 'MAGIC_LINK_MAILPIT_FAILED',
        message: 'Staging magic link delivery failed',
        payload: error,
        mode: 'warn',
      });
      return false;
    }
  }

  // Resend primary (when RESEND_API_KEY is present): same content and token, only another
  // transport (URL/token generated ONCE in sendVerificationRequest). Success ends it; failure falls
  // to Mailgun, then SMTP. One mail = one valid link.
  if (ENV_VARS.RESEND_API_KEY) {
    try {
      await sendViaResend({
        to: identifier,
        subject,
        text,
        html,
        headers,
        tags: ['magic-link'],
        disableClickTracking: ENV_VARS.NATIVE_DEEPLINK_ENABLED,
      });
      return true;
    } catch (error) {
      reportIssueBackend({
        namespace: 'MAGIC_LINK_RESEND_FAILED',
        message: 'Magic link Resend delivery failed, attempting Mailgun',
        payload: error,
        mode: 'warn',
      });
    }
  }

  if (
    ENV_VARS.MAILGUN_API_KEY &&
    ENV_VARS.MAILGUN_API_BASE_URL &&
    ENV_VARS.MAILGUN_DOMAIN
  ) {
    try {
      await sendViaMailgun({
        to: identifier,
        subject,
        text,
        html,
        headers,
        tags: ['magic-link'],
        // Gated with the rest of the cutover so the email is byte-identical to
        // today until NATIVE_DEEPLINK_ENABLED flips. When on: Mailgun must NOT
        // rewrite the href to a tracking domain (it would break the Universal/App
        // Link app-open and leak the one-time token to the ESP) — exactly when the
        // frontend-host deep-link rewrite needs the raw URL preserved.
        disableClickTracking: ENV_VARS.NATIVE_DEEPLINK_ENABLED,
      });
      return true;
    } catch (error) {
      reportIssueBackend({
        namespace: 'MAGIC_LINK_MAILGUN_FAILED',
        message: 'Magic link Mailgun delivery failed, attempting SMTP fallback',
        payload: error,
        mode: 'warn',
      });
    }
  }

  if (!isSmtpConfigured()) {
    return false;
  }

  try {
    await sendEmailViaSmtp({
      to: identifier,
      subject,
      text,
      html,
      headers,
    });
    return true;
  } catch (error) {
    reportIssueBackend({
      namespace: 'MAGIC_LINK_SMTP_FAILED',
      message: 'Magic link SMTP attempt failed',
      payload: error,
      mode: 'warn',
    });
    return false;
  }
};

export const sendVerificationRequest = async ({
  identifier,
  url,
}: MagicLinkRequestParams): Promise<void> => {
  // DECISION: locale resolution (resolveLocaleByEmail) is fail-open to pl and never blocks the
  // send, because a locale miss must not lock anyone out of the only login path.
  // unsubscribeUrl is '' (transactional login mail, no footer unsubscribe link).
  const verifyUrl = resolveMagicLinkUrl(url);
  const locale = await resolveLocaleByEmail(identifier);
  const { subject, text, html } = renderEmailTemplate(
    'magic-link',
    { url: verifyUrl },
    locale,
    '',
    'email.magicLink.subject'
  );

  // Jeden logiczny mail logowania = jeden X-Entity-Ref-ID, niezależnie od liczby
  // prób retry i wybranego transportu. Różny ref między KOLEJNYMI logowaniami →
  // Gmail nie zwija ich w wątek (patrz trySendMagicLink).
  const refId = randomUUID();

  // Magic link is the SOLE login path (Better Auth). Treat as critical: retry with bounded
  // backoff so a transient Mailgun/SMTP blip doesn't leave the user stranded. Final failure
  // is logged at error level — Better Auth still returns 200 to the caller to avoid
  // account enumeration via timing/error diff. Admin sees the failure in logs.
  for (let attempt = 1; attempt <= MAGIC_LINK_MAX_ATTEMPTS; attempt++) {
    const sent = await trySendMagicLink({
      identifier,
      subject,
      text,
      html,
      refId,
    });
    if (sent) {
      return;
    }
    if (attempt < MAGIC_LINK_MAX_ATTEMPTS) {
      // Mailgun daily cap hit → both transports fail-fast until reset; skip the
      // backoff so the loop still records the dead-letter but without wasted waits.
      if (isMailgunDailyLimited()) {
        continue;
      }
      await sleep(MAGIC_LINK_BASE_DELAY_MS * Math.pow(2, attempt - 1));
    }
  }

  const failureReason = isStagingMailpit()
    ? `All ${MAGIC_LINK_MAX_ATTEMPTS} Mailpit attempts failed`
    : `All ${MAGIC_LINK_MAX_ATTEMPTS} send attempts failed (Resend/Mailgun + SMTP fallback)`;

  reportIssueBackend({
    namespace: 'MAGIC_LINK_DELIVERY_LOST',
    message: `Magic link delivery failed after ${MAGIC_LINK_MAX_ATTEMPTS} attempts — user cannot log in`,
    payload: { identifier },
    mode: 'error',
  });

  // DECISION: await the dead-letter writes so the audit trail and the FailedEmail row are durable
  // before returning. Magic link is the only login path, and process death between the send
  // failure and the DB commit would silently lose the only trace of the failed login attempt.
  await recordAuditEvent_IO({
    eventName: APP_EVENTS.INFO.EMAIL.EMAIL_DEAD_LETTERED,
    user: { email: identifier },
    responseBody: {
      templateId: 'magic-link',
      to: identifier,
      attempts: MAGIC_LINK_MAX_ATTEMPTS,
      reason: failureReason,
    },
  }).catch(auditError => {
    reportIssueBackend({
      namespace: 'MAGIC_LINK_AUDIT_FAILED',
      message: 'Failed to record magic-link dead-letter audit event',
      payload: { identifier, error: auditError },
      mode: 'error',
    });
  });

  await DB_CLIENT.use.failedEmail
    .create({
      data: {
        recipient: identifier,
        template: 'magic-link',
        subject,
        payload: { templateId: 'magic-link' },
        error: failureReason,
        attempts: MAGIC_LINK_MAX_ATTEMPTS,
      },
    })
    .catch(deadLetterError => {
      reportIssueBackend({
        namespace: 'MAGIC_LINK_DEAD_LETTER_FAILED',
        message: 'Failed to write magic-link to dead-letter table',
        payload: { identifier, error: deadLetterError },
        mode: 'error',
      });
    });
};
