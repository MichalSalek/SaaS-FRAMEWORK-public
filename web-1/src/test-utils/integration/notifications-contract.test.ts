/**
 * Notification handlers bound through `defineEndpoint(contract)`.
 * Pins the mark-read 400, the list payload, and the register method gate.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import recent from '../../pages/api/v1/notifications/recent/index';
import markRead from '../../pages/api/v1/notifications/mark-read/index';
import register from '../../pages/api/v1/notifications/push/register/index';
import { mockApiHandler } from '../mockApiHandler';
import { __setCurrentUser } from '../setup';
import { makeCurrentUserOutput, makeClientCurrentUser } from '../fixtures';

const ops = vi.hoisted(() => ({
  recent: vi.fn(),
  mark: vi.fn(),
  register: vi.fn(),
}));

vi.mock(
  '@domain/notifications/operations/notification-query.operations',
  () => ({
    getRecentNotifications_IO: ops.recent,
    getUnreadNotificationsCount_IO: vi.fn(),
  })
);

vi.mock(
  '@domain/notifications/operations/notification-write.operations',
  () => ({
    markNotificationsRead_IO: ops.mark,
  })
);

vi.mock(
  '@domain/notifications/operations/push-subscription.operations',
  () => ({
    registerPushSubscription_IO: ops.register,
    unregisterPushSubscription_IO: vi.fn(),
  })
);

const CLIENT = makeClientCurrentUser();

describe('notifications through the API contract', () => {
  beforeEach(() => {
    ops.recent.mockReset();
    ops.mark.mockReset();
    ops.register.mockReset();
    __setCurrentUser(makeCurrentUserOutput(CLIENT));
  });

  it('recent: returns the operation payload and its success event', async () => {
    ops.recent.mockResolvedValue({
      success: true,
      data: { notifications: [], unread_count: 0 },
    });
    const { status, event, data } = await mockApiHandler(recent, {
      method: 'GET',
    });
    expect(status).toBe(200);
    expect(event).toBe('NOTIFICATIONS_FETCHED');
    expect(data).toEqual({ notifications: [], unread_count: 0 });
    expect(ops.recent).toHaveBeenCalledWith({
      userId: CLIENT.id,
      accountType: CLIENT.account_type,
    });
  });

  it('mark-read: a missing timestamp is 400 and never reaches the operation', async () => {
    const { status, event } = await mockApiHandler(markRead, {
      method: 'POST',
      body: {},
    });
    expect(status).toBe(400);
    expect(event).toBe('VALIDATION_FAILED');
    expect(ops.mark).not.toHaveBeenCalled();
  });

  it('mark-read: an unreadable timestamp is 400', async () => {
    const { status } = await mockApiHandler(markRead, {
      method: 'POST',
      body: { newest_seen_at: 'not-a-date' },
    });
    expect(status).toBe(400);
    expect(ops.mark).not.toHaveBeenCalled();
  });

  it('register: a GET is 405 with Allow taken from the contract', async () => {
    const result = await mockApiHandler(register, { method: 'GET' });
    expect(result.status).toBe(405);
    expect(result.data).toEqual({ allowed: 'POST' });
    expect(ops.register).not.toHaveBeenCalled();
  });
});
