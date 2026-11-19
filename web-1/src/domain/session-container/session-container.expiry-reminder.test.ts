import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TIME } from '@kernel/application/constants.config';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import { NotificationTypeValue } from '@kernel/models/notifications/notifications.dto';

const mocks = vi.hoisted(() => {
  const tx = {
    user: { findUnique: vi.fn() },
    clientStylistPair: { findFirst: vi.fn() },
    sessionContainer: { update: vi.fn() },
  };
  return {
    tx,
    findMany: vi.fn(),
    transaction: vi.fn(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)
    ),
    lock: vi.fn(),
    create: vi.fn(),
    push: vi.fn(),
    report: vi.fn(),
  };
});
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: { use: { sessionContainer: { findMany: mocks.findMany } } },
}));
vi.mock('@app/db/with-write-tx', () => ({ withWriteTx: mocks.transaction }));
vi.mock('@app/debugger/error-handler', () => ({
  reportIssueBackend: mocks.report,
}));
vi.mock('./session-activity.lock', () => ({
  lockSessionActivityContext: mocks.lock,
}));
vi.mock(
  '@domain/notifications/operations/notification-write.operations',
  () => ({ createOrRearmNotification_IO: mocks.create })
);
vi.mock('@domain/notifications/push/push-dispatch.service', () => ({
  dispatchPushForNotification_IO: mocks.push,
}));
import {
  SESSION_EXPIRY_REMINDER_DAYS,
  sendSessionExpiryReminders,
} from './session-container.expiry-reminder';

const NOW = new Date('2026-11-08T12:00:00Z');
const locked = {
  userId: 'client-user',
  activePairId: 'pair',
  session: {
    id: 'session-1',
    stylist_account_id: 'stylist-account',
    lifecycle_state: 'SHARED',
    shared_at: NOW,
    closed_at: null,
    expiry_reminder_sent_at: null,
    expires_at: new Date('2026-11-09T12:00:00Z'),
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMany.mockResolvedValue([{ id: 'session-1' }]);
  mocks.lock.mockResolvedValue(locked);
  mocks.tx.user.findUnique.mockResolvedValue({ is_active: true });
  mocks.tx.clientStylistPair.findFirst.mockResolvedValue({
    stylist_account: { created_by_user_id: 'stylist-user' },
  });
  mocks.tx.sessionContainer.update.mockResolvedValue({});
  mocks.create.mockImplementation(async (input: { userId: string }) => ({
    success: true,
    data: { created: true, notification: { user_id: input.userId } },
  }));
  mocks.push.mockResolvedValue({});
});

describe('session expiry reminder', () => {
  it('selects the three-day window, stores both intents without actor data, then dispatches', async () => {
    expect(await sendSessionExpiryReminders({ now: NOW })).toBe(1);
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          expires_at: {
            gt: NOW,
            lte: new Date(
              NOW.getTime() + SESSION_EXPIRY_REMINDER_DAYS * TIME.MS_PER_DAY
            ),
          },
          expiry_reminder_sent_at: null,
        }),
        select: { id: true },
      })
    );
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'client-user',
        recipientRole: AccountTypeValue.CLIENT,
        type: NotificationTypeValue.SESSION_EXPIRING_SOON,
        actorUserId: null,
        actorName: null,
        targetPath: '/app/sessions/session-1',
      }),
      mocks.tx
    );
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'stylist-user',
        recipientRole: AccountTypeValue.STYLIST,
        actorUserId: null,
        actorName: null,
        targetPath: '/app/inbox/session/session-1',
      }),
      mocks.tx
    );
    expect(mocks.tx.sessionContainer.update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: { expiry_reminder_sent_at: NOW },
    });
    expect(mocks.push).toHaveBeenCalledTimes(2);
    expect(mocks.report).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { count: 1 },
        message: 'Stored 1 inspiration-session expiry reminders',
      })
    );
  });
  it('does not count or push when a transactional notification write fails', async () => {
    mocks.create.mockRejectedValueOnce(new Error('write failed'));
    expect(await sendSessionExpiryReminders({ now: NOW })).toBe(0);
    expect(mocks.tx.sessionContainer.update).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.report).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'error' })
    );
  });
  it('reminds only the client when the stylist account was removed', async () => {
    mocks.lock.mockResolvedValueOnce({
      ...locked,
      activePairId: null,
      session: { ...locked.session, stylist_account_id: null },
    });
    expect(await sendSessionExpiryReminders({ now: NOW })).toBe(1);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'client-user',
        actorUserId: null,
        actorName: null,
      }),
      mocks.tx
    );
  });
  it('skips an assigned stylist whose pairing is no longer active', async () => {
    mocks.lock.mockResolvedValueOnce({ ...locked, activePairId: null });
    expect(await sendSessionExpiryReminders({ now: NOW })).toBe(0);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
  });
});
