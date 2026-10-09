import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { ENV_VARS } from '@app/environment/environment.config';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { type SendEmailParams } from '@app/email-handler/email.types';
import { isMailgunDailyLimited } from '@app/email-handler/mailgun-daily-limit.breaker';
import { shouldStubEmailSend } from '@app/email-handler/email-dev-sink';

/**
 * Lazy singleton SMTP transporter with connection pooling (M14 fix).
 * Created once on first use, reuses TCP connections across calls.
 */
let _transporter: Transporter | null = null;

const getTransporter = (): Transporter => {
  if (_transporter) {
    return _transporter;
  }

  if (
    !ENV_VARS.MAILGUN_SMTP_HOST ||
    !ENV_VARS.MAILGUN_SMTP_PORT ||
    !ENV_VARS.MAILGUN_SMTP_LOGIN ||
    !ENV_VARS.MAILGUN_SMTP_PASSWORD ||
    !ENV_VARS.FROM_EMAIL
  ) {
    reportIssueBackend({
      namespace: 'SMTP_CONFIG',
      message: 'Missing SMTP environment variables at startup',
      payload: {
        hasHost: Boolean(ENV_VARS.MAILGUN_SMTP_HOST),
        hasPort: Boolean(ENV_VARS.MAILGUN_SMTP_PORT),
        hasLogin: Boolean(ENV_VARS.MAILGUN_SMTP_LOGIN),
        hasPassword: Boolean(ENV_VARS.MAILGUN_SMTP_PASSWORD),
        hasFromEmail: Boolean(ENV_VARS.FROM_EMAIL),
      },
      mode: 'error',
    });
    throw new Error(APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED);
  }

  _transporter = nodemailer.createTransport({
    host: ENV_VARS.MAILGUN_SMTP_HOST,
    port: Number(ENV_VARS.MAILGUN_SMTP_PORT),
    secure: Number(ENV_VARS.MAILGUN_SMTP_PORT) === 465,
    pool: true,
    maxConnections: 3,
    auth: {
      user: ENV_VARS.MAILGUN_SMTP_LOGIN,
      pass: ENV_VARS.MAILGUN_SMTP_PASSWORD,
    },
    connectionTimeout: 10_000, // 10s (default: 2min)
    greetingTimeout: 10_000, // 10s (default: 30s)
    socketTimeout: 30_000, // 30s (default: 10min)
  });

  return _transporter;
};

export const sendEmailViaSmtp = async (
  params: SendEmailParams
): Promise<void> => {
  // Mailgun SMTP shares the SAME daily request cap as the HTTP API, so
  // when the daily-cap breaker is open the fallback would fail too — short-circuit
  // (no connection) to keep the storm-suppression total across both transports.
  if (isMailgunDailyLimited()) {
    throw new Error(
      'Mailgun daily request cap reached — SMTP fallback short-circuited (same quota as the HTTP API).'
    );
  }

  // Dev quota guard: SMTP is ALWAYS stubbed in DEVELOPMENT (shares the capped
  // Mailgun account, and dev does not exercise the fallback transport). Resolves
  // as success without delivering. Bypass with DEV_EMAIL_FORCE_LIVE=true.
  if (
    shouldStubEmailSend({
      to: params.to,
      subject: params.subject,
      transport: 'smtp',
    })
  ) {
    return;
  }

  const transporter = getTransporter();

  try {
    await transporter.sendMail({
      from: ENV_VARS.FROM_EMAIL,
      to: params.to,
      subject: params.subject,
      text: params.text,
      html: params.html,
      // Custom headers (List-Unsubscribe / List-Unsubscribe-Post / Reply-To) must
      // survive the SMTP fallback path — RFC 8058 compliance is transport-agnostic.
      ...(params.headers && Object.keys(params.headers).length > 0
        ? { headers: params.headers }
        : {}),
    });
  } catch (e) {
    reportIssueBackend({
      namespace: 'SMTP_SEND_EMAIL',
      message: 'Failed to send email via SMTP',
      payload: { to: params.to, subject: params.subject, error: e },
      mode: 'error',
    });
    throw e;
  }
};
