import { createHmac } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  verifyMailgunDelivery,
  verifyResendDelivery,
} from './delivery-webhook';
const secret = 'a-long-test-webhook-signing-secret';
const now = Date.now();
const timestamp = String(Math.floor(now / 1000));
const token = 'random-provider-token';
const mailgun = (severity = 'permanent') =>
  JSON.stringify({
    signature: {
      timestamp,
      token,
      signature: createHmac('sha256', secret)
        .update(timestamp + token)
        .digest('hex'),
    },
    'event-data': {
      id: 'event-1',
      event: 'failed',
      timestamp: now / 1000,
      severity,
      message: { headers: { 'message-id': 'mailgun-1' } },
      'user-variables': { lifecycle_message_id: 'message-1' },
    },
  });
describe('provider delivery signature verification', () => {
  it('verifies Mailgun and distinguishes delayed from permanent bounce', () => {
    expect(verifyMailgunDelivery(mailgun(), secret, now)).toMatchObject({
      kind: 'bounced',
      permanent: true,
      messageId: 'message-1',
    });
    expect(
      verifyMailgunDelivery(mailgun('temporary'), secret, now)
    ).toMatchObject({ kind: 'delayed', permanent: false });
  });
  it('rejects a wrong signing key and old signature', () => {
    expect(() =>
      verifyMailgunDelivery(mailgun(), 'wrong-secret', now)
    ).toThrow();
    expect(() =>
      verifyMailgunDelivery(mailgun(), secret, now + 301000)
    ).toThrow();
  });
  it('uses official Resend raw-body verification and rejects tampering', () => {
    const key = Buffer.from(secret).toString('base64');
    const id = 'msg_event_1';
    const body = JSON.stringify({
      type: 'email.delivered',
      created_at: new Date(now).toISOString(),
      data: {
        email_id: 'resend-1',
        tags: { lifecycle_message_id: 'message-1' },
      },
    });
    const signature =
      'v1,' +
      createHmac('sha256', Buffer.from(secret))
        .update(`${id}.${timestamp}.${body}`)
        .digest('base64');
    const headers = { id, timestamp, signature };
    expect(verifyResendDelivery(body, headers, 'whsec_' + key)).toMatchObject({
      kind: 'delivered',
      messageId: 'message-1',
    });
    expect(() =>
      verifyResendDelivery(body + ' ', headers, 'whsec_' + key)
    ).toThrow();
  });
});
