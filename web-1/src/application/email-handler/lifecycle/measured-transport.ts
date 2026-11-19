import { recordLifecycleDecision_IO } from './operational-decision';
import { isPrechargeReminderDisabled } from '@app/email-handler/email-precharge-reminder.policy';
import { normalizeProviderMessageId } from './provider-message-id';
import { Resend } from 'resend';
import Mailgun from 'mailgun.js';
import formData from 'form-data';
import type { EmailCategory } from '@kernel/domain/email/email-schedule.config';
import { ENV_VARS } from '@app/environment/environment.config';
import {
  getEmailIdentity,
  getEmailHeaders,
  getEmailReplyTo,
} from '../email-identity';
import { canSendEmail } from '../email-circuit-breaker';
import { shouldStubEmailSend } from '../email-dev-sink';
import { isStagingMailpit, sendStagingMailpit } from '../email-transport';
import type { SendEmailParams } from '../email.types';
import {
  reserveLifecycleMessage,
  markLifecycleSending,
  finishLifecycleMessage,
  type LifecycleReservation,
  type LifecycleSendResult,
} from './ledger';

const messageIdFrom = (value: unknown): string | null =>
  value !== null &&
  typeof value === 'object' &&
  'id' in value &&
  typeof value.id === 'string'
    ? value.id
    : null;
const sendMeasuredMailpit = async (
  params: SendEmailParams
): Promise<LifecycleSendResult> => {
  try {
    return {
      status: 'accepted',
      provider: 'mailpit',
      providerMessageId: await sendStagingMailpit(params),
    };
  } catch {
    // SMTP disconnect can occur after the sink accepted DATA. Do not retry as
    // a second provider or report a definite rejection.
    return { status: 'unknown', provider: 'mailpit', reason: 'provider_error' };
  }
};
export const sendMeasuredMailgun = async (
  params: SendEmailParams,
  messageId: string
): Promise<LifecycleSendResult> => {
  if (isStagingMailpit()) {
    return sendMeasuredMailpit(params);
  }
  if (
    !ENV_VARS.MAILGUN_API_KEY ||
    !ENV_VARS.MAILGUN_DOMAIN ||
    !ENV_VARS.MAILGUN_API_BASE_URL
  ) {
    return {
      status: 'rejected',
      provider: 'mailgun',
      reason: 'not_configured',
    };
  }
  const client = new Mailgun(formData).client(
    Object.assign(
      {
        username: 'api',
        key: ENV_VARS.MAILGUN_API_KEY,
        url: ENV_VARS.MAILGUN_API_BASE_URL,
      },
      { timeout: 20_000 }
    )
  ) as {
    messages: {
      create: (
        domain: string,
        data: Record<string, string>
      ) => Promise<unknown>;
    };
  };
  try {
    const result = await client.messages.create(ENV_VARS.MAILGUN_DOMAIN, {
      from: getEmailIdentity(ENV_VARS.FROM_EMAIL).from,
      to: params.to,
      subject: params.subject,
      text: params.text ?? ' ',
      html: params.html,
      'h:Reply-To': getEmailReplyTo(params.headers),
      'v:lifecycle_message_id': messageId,
      'o:tracking': 'no',
      ...Object.fromEntries(
        Object.entries(getEmailHeaders(params.headers)).map(([key, value]) => [
          `h:${key}`,
          value,
        ])
      ),
    });
    const id = messageIdFrom(result);
    return id
      ? {
          status: 'accepted',
          provider: 'mailgun',
          providerMessageId: normalizeProviderMessageId('mailgun', id),
        }
      : {
          status: 'unknown',
          provider: 'mailgun',
          reason: 'missing_provider_id',
        };
  } catch (error) {
    const status =
      error !== null && typeof error === 'object' && 'status' in error
        ? error.status
        : null;
    return {
      status:
        typeof status === 'number' && status >= 400 && status < 500
          ? 'rejected'
          : 'unknown',
      provider: 'mailgun',
      reason: 'provider_error',
    };
  }
};
/** Resend's JSON validation errors; `invalid_idempotency_key` and the SDK's `application_error` are not. */
const RESEND_VALIDATION_ERRORS: ReadonlySet<string> = new Set([
  'validation_error',
  'invalid_parameter',
  'missing_required_field',
  'invalid_from_address',
  'invalid_attachment',
]);

const isDefinitiveRetryRefusal = (
  refusal: { statusCode: number; name: string } | null
): boolean =>
  refusal !== null &&
  (refusal.statusCode === 400 || refusal.statusCode === 422) &&
  RESEND_VALIDATION_ERRORS.has(refusal.name);

export type MeasuredSendOptions = {
  /**
   * Awaited right BEFORE each provider call with the provider about to be contacted. A throw
   * aborts the send before that provider is called. The email outbox records the provider on its
   * ledger row here, so a crash mid-call leaves evidence of which provider may hold the message.
   */
  beforeProviderCall?: (
    provider: 'resend' | 'mailgun' | 'mailpit'
  ) => Promise<void>;
  /**
   * Retry of a message Resend may already hold: Resend first (same idempotency key); the Mailgun
   * fallback (no idempotency) only after a JSON 400/422 validation refusal of this request.
   */
  resendOnly?: boolean;
};

/** Unknown acceptance never falls through to a second provider. */
export const sendMeasuredLifecycleMessage = async (
  message: { id: string; templateId: string },
  params: SendEmailParams,
  category: EmailCategory = 'TRIAL_SEQUENCE',
  options: MeasuredSendOptions = {}
): Promise<LifecycleSendResult> => {
  if (isPrechargeReminderDisabled(message.templateId)) {
    return { status: 'suppressed', reason: 'precharge_reminder_disabled' };
  }
  if (isStagingMailpit()) {
    await options.beforeProviderCall?.('mailpit');
    return sendMeasuredMailpit(params);
  }
  if (!canSendEmail(category)) {
    return { status: 'suppressed', reason: 'circuit_open' };
  }
  if (
    shouldStubEmailSend({
      to: params.to,
      subject: params.subject,
      transport: 'resend',
    })
  ) {
    return { status: 'suppressed', reason: 'dev_sink' };
  }
  let resendRefusal: { statusCode: number; name: string } | null = null;
  const viaMailgun = async (): Promise<LifecycleSendResult> => {
    // DECISION: a Resend-only retry (Resend may already hold the message under this key) may fall
    // back to Mailgun ONLY after a refusal that proves Resend holds no copy: a 400/422 validation
    // error with Resend's own JSON body. With an identical payload a held message is replayed,
    // and a changed one answers 409. Auth and account checks (401/403), rate limits (429), a
    // malformed idempotency key and non-JSON errors (SDK `application_error`) happen before the
    // idempotency lookup and prove nothing: they stay unknown. A first attempt keeps the wide
    // rule (any 4xx except 408/409), as there is no earlier request to duplicate.
    if (options.resendOnly && !isDefinitiveRetryRefusal(resendRefusal)) {
      return {
        status: 'unknown',
        provider: 'resend',
        reason: 'resend_only_retry',
      };
    }
    await options.beforeProviderCall?.('mailgun');
    return sendMeasuredMailgun(params, message.id);
  };
  if (!ENV_VARS.RESEND_API_KEY) {
    return viaMailgun();
  }
  await options.beforeProviderCall?.('resend');
  let resendRefused = false;
  try {
    const result = await new Resend(ENV_VARS.RESEND_API_KEY).emails.send(
      {
        from: getEmailIdentity().from,
        replyTo: getEmailReplyTo(params.headers),
        to: params.to,
        subject: params.subject,
        text: params.text ?? ' ',
        html: params.html,
        headers: getEmailHeaders(params.headers),
        tags: [{ name: 'lifecycle_message_id', value: message.id }],
      },
      Object.assign(
        { idempotencyKey: `lifecycle/${message.id}` },
        { signal: AbortSignal.timeout(20_000) }
      )
    );
    if (result.data?.id) {
      return {
        status: 'accepted',
        provider: 'resend',
        providerMessageId: result.data.id,
      };
    }
    if (
      result.error &&
      result.error.statusCode !== null &&
      result.error.statusCode >= 400 &&
      result.error.statusCode < 500 &&
      result.error.statusCode !== 408 &&
      result.error.statusCode !== 409
    ) {
      resendRefused = true;
      resendRefusal = {
        statusCode: result.error.statusCode,
        name: result.error.name,
      };
    } else {
      return {
        status: 'unknown',
        provider: 'resend',
        reason: 'provider_error',
      };
    }
  } catch {
    return {
      status: 'unknown',
      provider: 'resend',
      reason: 'network_or_timeout',
    };
  }
  // Outside the try: a failing beforeProviderCall must surface to the caller, not read as a
  // Resend network error.
  return resendRefused
    ? viaMailgun()
    : { status: 'unknown', provider: 'resend', reason: 'provider_error' };
};
export const sendMeasuredLifecycleEmail = async (
  input: LifecycleReservation & {
    render: (messageId: string) => SendEmailParams;
    validate?: () => Promise<boolean>;
  }
): Promise<LifecycleSendResult & { messageId?: string }> => {
  const { render, validate, ...reservation } = input;
  if (isPrechargeReminderDisabled(reservation.templateId)) {
    return { status: 'suppressed', reason: 'precharge_reminder_disabled' };
  }
  if (validate && !(await validate())) {
    await recordLifecycleDecision_IO({
      identity: [
        reservation.accountId,
        reservation.occurrence,
        reservation.ruleId,
      ].join(':'),
      kind: 'suppressed',
      reason: 'eligibility_changed',
      family: reservation.family,
      templateId: reservation.templateId,
      ruleId: reservation.ruleId,
      locale: reservation.locale,
      cohort: reservation.cohort,
      plannedAt: reservation.scheduledAt,
    });
    return { status: 'suppressed', reason: 'eligibility_changed' };
  }
  const reserved = await reserveLifecycleMessage(reservation);
  if (reserved.kind !== 'reserved') {
    return { status: 'suppressed', reason: reserved.reason };
  }
  // Render before marking started. A crash after marking is deliberately held for reconciliation.
  let params: SendEmailParams;
  try {
    params = render(reserved.message.id);
  } catch {
    await finishLifecycleMessage(reserved.message.id, {
      status: 'suppressed',
      reason: 'render_error',
    });
    return { status: 'suppressed', reason: 'render_error' };
  }
  if (validate && !(await validate())) {
    await finishLifecycleMessage(reserved.message.id, {
      status: 'suppressed',
      reason: 'eligibility_changed',
    });
    return {
      status: 'suppressed',
      reason: 'eligibility_changed',
      messageId: reserved.message.id,
    };
  }
  if (!(await markLifecycleSending(reserved.message.id))) {
    return { status: 'suppressed', reason: 'already_started' };
  }
  const result = await sendMeasuredLifecycleMessage(
    { id: reserved.message.id, templateId: reservation.templateId },
    params,
    reservation.category
  );
  await finishLifecycleMessage(reserved.message.id, result);
  return { ...result, messageId: reserved.message.id };
};
