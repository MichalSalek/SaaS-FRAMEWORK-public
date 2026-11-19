import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { ENV_VARS } from '@app/environment/environment.config';
import {
  getEmailHeaders,
  getEmailIdentity,
  getEmailReplyTo,
} from '../email-identity';
import type { SendEmailParams } from '../email.types';

/** STAGING is isolated to the Compose service; no configurable external SMTP host. */
export const isStagingMailpit = (): boolean =>
  ENV_VARS.NODE_ENV_MANUAL === 'STAGING';
let transport: Transporter | undefined;
export const sendStagingMailpit = async (
  params: SendEmailParams
): Promise<string> => {
  if (
    !isStagingMailpit() ||
    ENV_VARS.MAILPIT_HOST !== 'mailpit' ||
    ENV_VARS.MAILPIT_PORT !== '1025'
  ) {
    throw new Error('Staging Mailpit configuration is invalid');
  }
  transport ??= nodemailer.createTransport({
    host: 'mailpit',
    port: 1025,
    secure: false,
    ignoreTLS: true,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  const result = await transport.sendMail({
    from: getEmailIdentity().from,
    replyTo: getEmailReplyTo(params.headers),
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html,
    headers: getEmailHeaders(params.headers),
  });
  if (
    !result.messageId ||
    !Array.isArray(result.accepted) ||
    result.accepted.length === 0 ||
    (Array.isArray(result.rejected) && result.rejected.length > 0)
  ) {
    throw new Error('Mailpit did not accept the recipient');
  }
  return result.messageId;
};
