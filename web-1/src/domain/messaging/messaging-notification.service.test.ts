/**
 * A stylist without a name (role-only onboarding, owner) still
 * notifies her client: the sender is named by her role in the recipient's
 * language. A client without a name is still skipped (PII minimum on PENDING).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDb } from '../../test-utils/mockApiHandler';
import { StylistClientMessageSenderValue } from '@kernel/models/db_models.generated.dto';
import { sendMessagingNotification } from './messaging-notification.service';

const { sendTransactionalEmail, resolveLocaleByEmail } = vi.hoisted(() => ({
  sendTransactionalEmail: vi.fn(async (..._args: unknown[]) => true),
  resolveLocaleByEmail: vi.fn(async (_email: string) => 'de' as const),
}));
vi.mock('@app/email-handler/email-transactional', () => ({
  sendTransactionalEmail,
}));
vi.mock('@app/email-handler/email-locale.resolver', () => ({
  resolveLocaleByEmail,
}));

const recipient = {
  email: 'client@example.com',
  name: 'Ola',
  is_active: true,
  deleted_at: null,
  notifications_enabled: true,
};

beforeEach(() => {
  sendTransactionalEmail.mockClear();
  mockDb({ user: { findUnique: async () => recipient } });
});

describe('sendMessagingNotification sender name', () => {
  it('names a nameless stylist by her role in the recipient language', async () => {
    await sendMessagingNotification({
      recipientUserId: 'usr_client',
      senderName: '  ',
      senderSide: StylistClientMessageSenderValue.STYLIST,
      pairId: 'pair_1',
    });
    const call = sendTransactionalEmail.mock.calls[0];
    expect((call?.[3] as Record<string, string>)['senderName']).toBe(
      'Ihre Stylistin'
    );
    expect(call?.[4]).toBe('email.messagingNotification.subjectFromStylist');
    expect(call?.[5]).toBe('de');
  });

  it('keeps a real name and the regular subject', async () => {
    await sendMessagingNotification({
      recipientUserId: 'usr_client',
      senderName: 'Studio Ani',
      senderSide: StylistClientMessageSenderValue.STYLIST,
      pairId: 'pair_1',
    });
    const call = sendTransactionalEmail.mock.calls[0];
    expect((call?.[3] as Record<string, string>)['senderName']).toBe(
      'Studio Ani'
    );
    expect(call?.[4]).toBe('email.messagingNotification.subject');
  });

  it('still skips a nameless client', async () => {
    await sendMessagingNotification({
      recipientUserId: 'usr_stylist',
      senderName: '',
      senderSide: StylistClientMessageSenderValue.CLIENT,
      pairId: 'pair_1',
    });
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });
});
