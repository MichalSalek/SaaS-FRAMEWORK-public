import Mailgun from 'mailgun.js';
import formData from 'form-data';
import { ENV_VARS } from '@app/environment/environment.config';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { type SendEmailParams } from '@app/email-handler/email.types';
import { HTTP_CLIENT_CONFIG } from '@kernel/application/constants.config';
import {
  isMailgunDailyLimited,
  noteMailgunErrorForDailyLimit,
} from '@app/email-handler/mailgun-daily-limit.breaker';
import { shouldStubEmailSend } from '@app/email-handler/email-dev-sink';

type MailgunMessageData = Record<string, string | string[] | undefined>;
type MailgunClient = {
  messages: {
    create: (domain: string, data: MailgunMessageData) => Promise<unknown>;
  };
};

/**
 * Lazy singleton Mailgun client (M15 fix).
 * Created once on first use, cached at module level.
 */
let _mailgunClient: MailgunClient | null = null;

const getMailgunClient = (): MailgunClient => {
  if (_mailgunClient) {
    return _mailgunClient;
  }

  const apiKey = ENV_VARS.MAILGUN_API_KEY;
  const apiBase = ENV_VARS.MAILGUN_API_BASE_URL;

  if (!apiKey || !apiBase) {
    throw new Error('Mailgun configuration is missing (API Key or Base URL)');
  }

  const mg = new Mailgun(formData);
  // DECISION (nie usuwaj tego komentarza):
  // `timeout` istnieje w MailgunClientOptions (mailgun.js v12 — MailgunClientOptions.d.ts),
  // ale TS 5.9 z moduleResolution=bundler + exactOptionalPropertyTypes nie widzi go
  // przez głęboko zagnieżdżony łańcuch re-exportów. Spread assignment omija excess
  // property check przy zachowaniu pełnego type safety (object nie jest literal).
  const clientOptions = { username: 'api', key: apiKey, url: apiBase };
  _mailgunClient = mg.client(
    Object.assign(clientOptions, { timeout: HTTP_CLIENT_CONFIG.TIMEOUT_MS })
  ) as MailgunClient;

  return _mailgunClient;
};

export const sendEmail = async (params: SendEmailParams): Promise<void> => {
  const domain = ENV_VARS.MAILGUN_DOMAIN;
  const from = ENV_VARS.FROM_EMAIL;

  if (!domain || !from) {
    throw new Error('Mailgun configuration is missing (Domain or From Email)');
  }

  // Daily-cap breaker: once Mailgun's daily request quota is exhausted, EVERY
  // further request hard-fails with 429 until the next-day reset. Fail FAST (no
  // network call) so retries + SMTP fallback + sweeps don't storm the provider.
  if (isMailgunDailyLimited()) {
    throw new Error(
      'Mailgun daily request cap reached — send short-circuited (see MAILGUN_DAILY_LIMIT_TRIPPED).'
    );
  }

  // Dev quota guard: in DEVELOPMENT, only the first N canary sends are real; the
  // rest are stubbed (resolved as success, not delivered) so the startup smoke
  // suite does not burn the daily quota on every container restart.
  if (
    shouldStubEmailSend({
      to: params.to,
      subject: params.subject,
      transport: 'mailgun',
    })
  ) {
    return;
  }

  const mailgun = getMailgunClient();

  try {
    // Build message data with base fields
    const messageData: MailgunMessageData = {
      from,
      to: params.to,
      subject: params.subject,
      text: params.text ?? ' ',
      html: params.html,
    };

    // Add custom headers if provided (Mailgun uses 'h:' prefix for custom headers)
    if (params.headers) {
      for (const [key, value] of Object.entries(params.headers)) {
        messageData[`h:${key}`] = value;
      }
    }

    // Add tags
    if (params.tags && params.tags.length > 0) {
      messageData['o:tag'] = params.tags;
    }

    // Disable click-tracking for auth links (magic-link). Mailgun otherwise
    // rewrites the href to a tracking domain that the OS will not treat as a
    // Universal/App Link (the phone never opens the native app) and which leaks
    // the one-time token to the ESP. 'no' overrides any domain-level default.
    if (params.disableClickTracking) {
      messageData['o:tracking-clicks'] = 'no';
    }

    await mailgun.messages.create(domain, messageData);
  } catch (err) {
    // Trip the daily-cap breaker on a 429 "daily request limit exceeded" so the
    // NEXT send short-circuits instead of hitting the wall again. A transient
    // (per-second) 429 is NOT classified as the daily cap — see the breaker.
    noteMailgunErrorForDailyLimit(err);
    reportIssueBackend({
      namespace: 'MAILGUN_SEND_ERROR',
      message: 'Failed to send email via Mailgun',
      payload: { error: err, to: params.to, subject: params.subject },
      mode: 'error',
    });
    throw err;
  }
};
