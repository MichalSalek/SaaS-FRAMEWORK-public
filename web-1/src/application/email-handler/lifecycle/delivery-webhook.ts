import { createHmac, timingSafeEqual } from 'node:crypto';
import { Resend } from 'resend';
import { z } from 'zod';
import type { LifecycleDeliveryInput } from './ledger-delivery';
import { normalizeProviderMessageId } from './provider-message-id';
const resendEvent = z.object({
  type: z.string(),
  created_at: z.iso.datetime(),
  data: z.object({
    email_id: z.string(),
    tags: z
      .union([
        z.record(z.string(), z.string()),
        z.array(z.object({ name: z.string(), value: z.string() })),
      ])
      .optional(),
  }),
});
const mailgunEvent = z.object({
  signature: z.object({
    timestamp: z.string(),
    token: z.string(),
    signature: z.string(),
  }),
  'event-data': z.object({
    id: z.string(),
    event: z.string(),
    timestamp: z.number(),
    severity: z.string().optional(),
    message: z.object({ headers: z.object({ 'message-id': z.string() }) }),
    'user-variables': z.record(z.string(), z.unknown()).optional(),
  }),
});
const kinds: Record<string, LifecycleDeliveryInput['kind']> = {
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delayed',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  delivered: 'delivered',
  failed: 'bounced',
  complained: 'complained',
};
const kindFrom = (kind: string): LifecycleDeliveryInput['kind'] | null =>
  kinds[kind] ?? null;

export const verifyResendDelivery = (
  body: string,
  headers: { id: string; timestamp: string; signature: string },
  secret: string
): LifecycleDeliveryInput | null => {
  // Official verifier checks the raw payload signature and timestamp replay window.
  const verified = new Resend('webhook-verification').webhooks.verify({
    payload: body,
    headers,
    webhookSecret: secret,
  });
  const kind = kindFrom(verified.type);
  if (!kind) {
    return null;
  }
  const event = resendEvent.parse(verified);
  const tags = event.data.tags;
  const id = Array.isArray(tags)
    ? tags.find(tag => tag.name === 'lifecycle_message_id')?.value
    : tags?.lifecycle_message_id;
  return {
    provider: 'resend',
    providerEventId: headers.id,
    providerMessageId: event.data.email_id,
    kind,
    occurredAt: new Date(event.created_at),
    permanent: kind === 'bounced',
    ...(id ? { messageId: id } : {}),
  };
};
export const verifyMailgunDelivery = (
  body: string,
  secret: string,
  now = Date.now()
): LifecycleDeliveryInput | null => {
  const parsed = mailgunEvent.parse(JSON.parse(body));
  const { timestamp, token, signature } = parsed.signature;
  if (
    !Number.isFinite(Number(timestamp)) ||
    Math.abs(now - Number(timestamp) * 1000) > 300_000
  ) {
    throw new Error('Expired webhook signature');
  }
  const expected = createHmac('sha256', secret)
    .update(timestamp + token)
    .digest();
  const actual = Buffer.from(signature, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error('Invalid webhook signature');
  }
  const event = parsed['event-data'];
  const kind =
    event.event === 'failed' && event.severity === 'temporary'
      ? 'delayed'
      : kindFrom(event.event);
  if (!kind) {
    return null;
  }
  const id = event['user-variables']?.lifecycle_message_id;
  return {
    provider: 'mailgun',
    providerEventId: event.id,
    replayToken: token,
    providerMessageId: normalizeProviderMessageId(
      'mailgun',
      event.message.headers['message-id']
    ),
    kind,
    occurredAt: new Date(event.timestamp * 1000),
    permanent: event.severity === 'permanent',
    ...(typeof id === 'string' ? { messageId: id } : {}),
  };
};
