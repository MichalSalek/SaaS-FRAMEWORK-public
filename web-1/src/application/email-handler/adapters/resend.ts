import {
  getEmailHeaders,
  getEmailReplyTo,
  getEmailIdentity,
} from '../email-identity';
import { Resend, type CreateEmailRequestOptions } from 'resend';
import { ENV_VARS } from '@app/environment/environment.config';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { type SendEmailParams } from '@app/email-handler/email.types';
import { shouldStubEmailSend } from '@app/email-handler/email-dev-sink';
import { HTTP_CLIENT_CONFIG } from '@kernel/application/constants.config';

/**
 * Lazy singleton Resend client (parity with the Mailgun adapter).
 * Created on first use, cached at module level.
 */
let _resendClient: Resend | null = null;

const getResendClient = (): Resend => {
  if (_resendClient) {
    return _resendClient;
  }

  const apiKey = ENV_VARS.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('Resend configuration is missing (RESEND_API_KEY)');
  }

  _resendClient = new Resend(apiKey);
  return _resendClient;
};

/**
 * Sends mail through Resend (primary when RESEND_ENABLED=true).
 * Same signature as the Mailgun adapter, so they are interchangeable in the transport chain
 * (email-transport.ts / magic-link.adapter.ts). THROWS on failure to trigger the Mailgun fallback.
 */
export const sendEmail = async (params: SendEmailParams): Promise<void> => {
  const { from } = getEmailIdentity();

  // Dev quota guard (parity z Mailgun): w DEVELOPMENT pierwszy send to canary,
  // reszta stub, by iteracja nie paliła dziennego limitu Resend.
  // Prod NIGDY nie stubuje.
  if (
    shouldStubEmailSend({
      to: params.to,
      subject: params.subject,
      transport: 'resend',
    })
  ) {
    return;
  }

  const client = getResendClient();

  // Resend does not rewrite links by default (click tracking is opt-in), so disableClickTracking
  // is a deliberate no-op here: the magic-link href stays raw and the one-time token never
  // reaches the ESP. Mailgun, unlike Resend, needs an explicit o:tracking-clicks=no.
  // DECISION: the request is bounded by an AbortSignal. The SDK calls a bare fetch, so a stalled
  // Resend socket held the whole send and its retry cascade for Node's multi-minute default, and
  // runEmailRequestOnce makes duplicate clicks wait on that same send. The SDK spreads request
  // options into fetch(), so the signal works although its option types do not list it; the
  // typed variable keeps the call cast-free. Budget = Mailgun's client timeout.
  const requestOptions: CreateEmailRequestOptions & { signal: AbortSignal } = {
    signal: AbortSignal.timeout(HTTP_CLIENT_CONFIG.TIMEOUT_MS),
  };
  const { error } = await client.emails.send(
    {
      from,
      replyTo: getEmailReplyTo(params.headers),
      to: params.to,
      subject: params.subject,
      text: params.text ?? ' ',
      html: params.html,
      ...(params.headers && Object.keys(params.headers).length > 0
        ? { headers: getEmailHeaders(params.headers) }
        : {}),
      ...(params.tags && params.tags.length > 0
        ? { tags: params.tags.map(tag => ({ name: tag, value: tag })) }
        : {}),
    },
    requestOptions
  );

  // DECISION: the Resend SDK does not throw on an API error, it returns { data, error }. We throw
  // ourselves so the fallback chain (Mailgun, SMTP) in email-transport / magic-link engages.
  if (error) {
    reportIssueBackend({
      namespace: 'RESEND_SEND_ERROR',
      message: 'Failed to send email via Resend',
      payload: { error, to: params.to, subject: params.subject },
      mode: 'error',
    });
    throw new Error(
      `Resend send failed: ${error.message ?? error.name ?? 'unknown'}`
    );
  }
};
