import { expect } from 'vitest';
import type { PrismaClient } from '../../src/prisma/js-client';
import {
  reserveLifecycleMessage,
  markLifecycleSending,
  finishLifecycleMessage,
} from '@app/email-handler/lifecycle/ledger';
import { recordLifecycleDelivery } from '@app/email-handler/lifecycle/ledger-delivery';

/** Mailgun sends angle brackets in the API result, but omits them in webhook headers. */
export async function verifyMailgunDeliveryFormat(
  client: PrismaClient,
  now: Date
) {
  const user = await client.user.create({
    data: {
      id: 'mailgun-format',
      email: 'mailgun-format@example.test',
      role_id: 'role',
    },
  });
  const reserved = await reserveLifecycleMessage(
    {
      userId: user.id,
      accountId: user.id,
      family: 'qa',
      ruleId: 'mailgun',
      templateId: 'free-first-photo',
      occurrence: 'format-test',
      contentVersion: '1',
      locale: 'pl',
      cohort: 'qa',
      ctaIds: ['primary'],
      recipientEmail: user.email,
      scheduledAt: now,
    },
    now
  );
  expect(reserved.kind).toBe('reserved');
  if (reserved.kind !== 'reserved') {
    throw new Error('Expected reservation');
  }
  await markLifecycleSending(reserved.message.id);
  await finishLifecycleMessage(reserved.message.id, {
    status: 'accepted',
    provider: 'mailgun',
    providerMessageId: '<provider-message@mg.example.test>',
  });
  const callback = {
    provider: 'mailgun' as const,
    providerEventId: 'mailgun-format-delivered',
    providerMessageId: 'provider-message@mg.example.test',
    messageId: reserved.message.id,
    kind: 'delivered' as const,
    occurredAt: now,
  };
  expect(await recordLifecycleDelivery(callback)).toBe(true);
  expect(
    await recordLifecycleDelivery({
      ...callback,
      providerMessageId: '<provider-message@mg.example.test>',
    })
  ).toBe(true);
  const message = await client.emailLifecycleMessage.findUniqueOrThrow({
    where: { id: reserved.message.id },
  });
  expect(message.deliveryStatus).toBe('delivered');
  expect(message.providerMessageId).toBe('provider-message@mg.example.test');
  expect(
    await client.emailDeliveryEvent.count({ where: { messageId: message.id } })
  ).toBe(1);
}
