/**
 * A support reply is a notification: the team's reply becomes ONE person-
 * addressed row per thread, re-armed by every next reply, with no actor.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (payload: unknown) => Promise<void>;
const captured = vi.hoisted(() => new Map<string, Handler>());
const notifyUser_IO = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => undefined)
);

vi.mock('@app/events/event-bus', () => ({
  subscribeToInfoEvent: (event: string, handler: Handler) => {
    captured.set(event, handler);
    return () => undefined;
  },
}));
vi.mock('@domain/notifications/notify-user.service', () => ({
  notifyUser_IO,
}));

import './support-admin-replied.listener';

beforeEach(() => {
  notifyUser_IO.mockClear();
});

describe('support-admin-replied listener', () => {
  it('writes a role-less row for the thread owner, keyed by the thread, re-armed, leading to the thread', async () => {
    const handler = captured.get('SUPPORT_ADMIN_REPLIED');
    expect(handler).toBeDefined();
    await handler?.({ threadId: 'thr_1', ownerUserId: 'usr_owner' });
    expect(notifyUser_IO).toHaveBeenCalledTimes(1);
    expect(notifyUser_IO.mock.calls[0]?.[0]).toEqual({
      userId: 'usr_owner',
      recipientRole: null,
      type: 'SUPPORT_REPLY_RECEIVED',
      dedupKey: 'SUPPORT_REPLY_RECEIVED:thr_1',
      actorUserId: null,
      actorName: null,
      targetPath: '/app/user/support/thr_1',
      rearm: true,
    });
  });

  it('a second reply in the same thread lands on the same key (re-arm, not a new row)', async () => {
    const handler = captured.get('SUPPORT_ADMIN_REPLIED');
    await handler?.({ threadId: 'thr_1', ownerUserId: 'usr_owner' });
    await handler?.({ threadId: 'thr_1', ownerUserId: 'usr_owner' });
    const keys = notifyUser_IO.mock.calls.map(
      call => (call[0] as { dedupKey: string; rearm: boolean }).dedupKey
    );
    expect(keys).toEqual([
      'SUPPORT_REPLY_RECEIVED:thr_1',
      'SUPPORT_REPLY_RECEIVED:thr_1',
    ]);
  });
});
