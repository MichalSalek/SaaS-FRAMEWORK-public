/**
 * Integration-handler — a support reply is a notification (2026-10-22).
 *
 * Only the team's reply emits SUPPORT_ADMIN_REPLIED (an orphaned thread emits
 * nothing), the user's own message never does, and opening the thread
 * (mark-thread-read) closes its notification row by key prefix.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const emitInfoEvent = vi.hoisted(() => vi.fn());
const markNotificationsReadByKeyPrefix_IO = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => ({ success: true, data: 1 }))
);
const adminReplyToThread_IO = vi.hoisted(() => vi.fn());
const addSupportMessage_IO = vi.hoisted(() => vi.fn());
const markSupportThreadRead_IO = vi.hoisted(() => vi.fn());

vi.mock('@app/events/event-bus', () => ({
  emitInfoEvent,
  subscribeToInfoEvent: () => () => undefined,
}));
// Run fire-and-forget tasks inline so the mark-read side effect is observable.
vi.mock('@app/runtime/run-after-response', () => ({
  runAfterResponse: (task: () => Promise<unknown>): void => {
    void task();
  },
  drainAfterResponseTasks: async (): Promise<void> => {},
}));
vi.mock('@app/event-log/event-log-io.wrapper', () => ({
  recordAuditEvent_IO: async () => undefined,
}));
vi.mock('@domain/support/support-email.service', () => ({
  sendSupportReplyNotification: async () => undefined,
  sendSupportNewMessageAdminAlert: async () => undefined,
}));
vi.mock(
  '@domain/notifications/operations/notification-write.operations',
  () => ({ markNotificationsReadByKeyPrefix_IO })
);
vi.mock('@domain/support/operations/support-admin.operations', () => ({
  adminReplyToThread_IO,
}));
vi.mock('@domain/support/operations/support-thread.operations', () => ({
  addSupportMessage_IO,
}));
vi.mock('@domain/support/operations/support-read-marker.operations', () => ({
  markSupportThreadRead_IO,
}));

import adminReplyHandler from '../../pages/api/v1/admin/support/reply/index';
import addMessageHandler from '../../pages/api/v1/support/add-message/index';
import markReadHandler from '../../pages/api/v1/support/mark-thread-read/index';
import { mockApiHandler } from '../mockApiHandler';
import { __setCurrentUser, __setPermission } from '../setup';
import { makeCurrentUserOutput, makeStylistCurrentUser } from '../fixtures';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

const THREAD_ID = 'thr_test_000000000000001';

beforeEach(() => {
  __setCurrentUser(makeCurrentUserOutput(makeStylistCurrentUser()));
  __setPermission(true);
  emitInfoEvent.mockClear();
  markNotificationsReadByKeyPrefix_IO.mockClear();
});

describe('support reply → notification', () => {
  it('the team reply emits SUPPORT_ADMIN_REPLIED for the thread owner', async () => {
    adminReplyToThread_IO.mockResolvedValueOnce({
      success: true,
      data: {
        message_id: 'msg_1',
        user_email: 'owner@example.com',
        subject: 'Temat',
        owner_user_id: 'usr_owner',
      },
    });
    const { status } = await mockApiHandler(adminReplyHandler, {
      method: 'POST',
      body: { thread_id: THREAD_ID, content: 'Dzień dobry, już działa.' },
    });
    expect(status).toBe(201);
    expect(emitInfoEvent).toHaveBeenCalledWith(
      APP_EVENTS.INFO.SUPPORT.SUPPORT_ADMIN_REPLIED,
      { threadId: THREAD_ID, ownerUserId: 'usr_owner' }
    );
  });

  it('an orphaned thread (owner gone) emits nothing', async () => {
    adminReplyToThread_IO.mockResolvedValueOnce({
      success: true,
      data: {
        message_id: 'msg_2',
        user_email: '',
        subject: 'Temat',
        owner_user_id: null,
      },
    });
    const { status } = await mockApiHandler(adminReplyHandler, {
      method: 'POST',
      body: { thread_id: THREAD_ID, content: 'Dzień dobry, już działa.' },
    });
    expect(status).toBe(201);
    expect(emitInfoEvent).not.toHaveBeenCalled();
  });

  it("the user's own message emits no notification event", async () => {
    addSupportMessage_IO.mockResolvedValueOnce({
      success: true,
      data: { message_id: 'msg_3', subject: 'Temat' },
    });
    await mockApiHandler(addMessageHandler, {
      method: 'POST',
      body: { thread_id: THREAD_ID, content: 'Dalej nie działa u mnie.' },
    });
    expect(emitInfoEvent).not.toHaveBeenCalled();
  });

  it('opening the thread closes its notification row by key prefix', async () => {
    markSupportThreadRead_IO.mockResolvedValueOnce({
      success: true,
      data: { thread_id: THREAD_ID },
    });
    const { status } = await mockApiHandler(markReadHandler, {
      method: 'POST',
      body: { thread_id: THREAD_ID },
    });
    expect(status).toBe(200);
    expect(markNotificationsReadByKeyPrefix_IO).toHaveBeenCalledWith({
      userId: makeStylistCurrentUser().id,
      keyPrefix: `SUPPORT_REPLY_RECEIVED:${THREAD_ID}`,
    });
  });
});
