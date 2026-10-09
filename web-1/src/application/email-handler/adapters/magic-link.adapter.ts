import { ENV_VARS } from '@app/environment/environment.config';
import { IS_DEVELOPMENT_ENV } from '@app/environment/environment.utils.api';
import { resolveCanonicalFrontendOrigin } from '@app/auth/better-auth/auth-token-bridge';
import { sendEmail as sendViaMailgun } from './mailgun';
import { sendEmail as sendViaResend } from './resend';
import { sendEmailViaSmtp } from './smtp';
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

// DECISION (nie usuwaj tego komentarza):
// 3 próby (NIE kanoniczne RETRY.EMAIL_MAX_ATTEMPTS=2 zredukowane dla oszczędności
// Mailgun-quoty) — magic-link to JEDYNA ścieżka logowania: niedostarczony mail =
// user nie wejdzie do aplikacji. Gdy dzienna quota wyczerpana, retry i tak
// short-circuituje natychmiast przez isMailgunDailyLimited() (zero zużycia kwoty),
// więc dodatkowa próba kosztuje wyłącznie przy TRANSIENT failu — tam wyższa
// niezawodność logowania bije marginalną oszczędność. Osobna decyzja, NIE scalać.
const MAGIC_LINK_MAX_ATTEMPTS = 3;
// DECISION (nie usuwaj tego komentarza):
// 500ms (NIE kanoniczne RETRY.BASE_DELAY_MS=1000) — magic-link send biegnie w budżecie
// HTTP requestu logowania, okno backoffu celowo ciaśniejsze. Różna wartość = osobna
// decyzja, NIE scalać z kernel RETRY.
const MAGIC_LINK_BASE_DELAY_MS = 500;

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

/**
 * Native deep-link (cutover-gated): point the magic-link verify URL at the
 * FRONTEND (associated) origin instead of the backend, so a phone tap opens the
 * native app via Universal Links (iOS) / App Links (Android). The frontend
 * proxies `/api/auth/*` straight back to the backend (main next.config rewrite),
 * so verify still runs server-side and the EXISTING token bridge appends
 * `?authCode` on that same frontend origin.
 *
 * Uses the SAME resolveCanonicalFrontendOrigin() the bridge swaps to, so the
 * email's first-hop host is byte-identical to the final authCode landing host
 * (one OS-verified associated domain end to end).
 *
 * INERT until NATIVE_DEEPLINK_ENABLED (no behaviour change to current prod).
 * Skipped in development — the dev magic-link already targets the dev frontend
 * port via BETTER_AUTH_URL. Fail-open: a parse error keeps the original
 * backend link so a misconfig can never block the SOLE login path.
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
  // X-Entity-Ref-ID: unikalny per-mail identyfikator, którego Gmail używa do
  // ROZBICIA wątku — bez niego kolejne magic-linki (zawsze ten sam subject) są
  // zwijane w jeden wątek i user widzi tylko najstarszy/najnowszy, łatwo klika
  // wygasły. Generowany RAZ w sendVerificationRequest i współdzielony przez
  // wszystkie 3 transporty fallbacku ORAZ wszystkie próby retry — to ten sam
  // logiczny mail (max jeden faktycznie dostarczony), więc współdzieli ref.
  const headers = { 'X-Entity-Ref-ID': refId };
  // Resend primary (gdy RESEND_API_KEY obecny) — ta sama treść i token, tylko inny
  // transport (URL/token wygenerowany RAZ w sendVerificationRequest). Sukces
  // kończy; błąd → Mailgun → SMTP. Jeden mail = jeden ważny link (spar #6).
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
  // DECISION (nie usuwaj tego komentarza):
  // Magic link is the SOLE login path (Better Auth). The subject/text/html now come from
  // the locale-aware template renderer instead of hardcoded PL strings, so EN/DE users get
  // their own language. Locale resolution (resolveLocaleByEmail) is fail-open to pl and
  // NEVER blocks the send — a locale miss must not lock anyone out. The send path below
  // (retry + dead-letter + audit) is unchanged; only the SOURCE of subject/text/html moved
  // from hardcode to render. unsubscribeUrl is '' — transactional login email, no footer
  // unsubscribe link (parity with the previous hardcoded email).
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

  const failureReason = `All ${MAGIC_LINK_MAX_ATTEMPTS} send attempts failed (Resend/Mailgun + SMTP fallback)`;

  reportIssueBackend({
    namespace: 'MAGIC_LINK_DELIVERY_LOST',
    message: `Magic link delivery failed after ${MAGIC_LINK_MAX_ATTEMPTS} attempts — user cannot log in`,
    payload: { identifier },
    mode: 'error',
  });

  // DECISION (nie usuwaj tego komentarza):
  // Magic link is the SOLE login path — once delivery is lost, the user is locked out.
  // Await dead-letter writes so audit trail and FailedEmail row are durable before
  // returning. Otherwise process death between send-failure and DB-commit silently
  // loses the only trace of the failed login attempt. Matches pattern in
  // email-transactional.ts:175-205.
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
