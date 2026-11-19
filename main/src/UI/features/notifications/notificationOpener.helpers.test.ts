import { describe, expect, it } from 'vitest';
import type { NotificationDTO } from '@kernel/models/notifications/notifications.dto';
import { notificationTarget } from './notificationOpener.helpers';

const notification: NotificationDTO = {
  id: 'n1',
  type: 'MESSAGE_RECEIVED',
  actor_name: null,
  target_path: '/app/messages/pair',
  created_at: '2026-11-06T00:00:00Z',
  read_at: null,
};
describe('notification target', () => {
  it.each([
    ['STYLIST', 'SESSION_SUBMITTED'],
    ['CLIENT', 'SESSION_ACCEPTED'],
    ['STYLIST', 'SESSION_CHANGED'],
  ] as const)('opens the conversation for %s %s activity', (role, kind) => {
    expect(
      notificationTarget({
        ...notification,
        recipient_role: role,
        activity_kind: kind,
        session_id: 's1',
      })
    ).toBe('/app/messages/pair');
  });
  it('selects the role-specific session without trusting a raw target', () => {
    expect(
      notificationTarget({
        ...notification,
        activity_kind: 'SESSION_SUBMITTED',
        session_id: 's1',
        recipient_role: 'STYLIST',
        target_path: 'https://example.com',
      })
    ).toBe('/app/inbox/session/s1');
    expect(
      notificationTarget({
        ...notification,
        activity_kind: 'SESSION_ACCEPTED',
        session_id: 's1',
        recipient_role: 'CLIENT',
        target_path: '/app/sessions/s1',
      })
    ).toBe('/app/sessions/s1');
    expect(
      notificationTarget({
        ...notification,
        activity_kind: 'SESSION_ACCEPTED',
        session_id: null,
        recipient_role: 'CLIENT',
      })
    ).toBeNull();
  });
  it.each([
    '/app/messages/',
    '/app/messages/..',
    '/app/messages/pair/other',
    '/app/messages/%2f%2fevil',
    '/app/messages/pair?next=https://example.com',
    '/app/messages/pair\\evil',
  ])(
    'keeps the safe legacy fallback for malformed conversation target %s',
    target_path => {
      expect(
        notificationTarget({
          ...notification,
          activity_kind: 'SESSION_SUBMITTED',
          session_id: 's1',
          recipient_role: 'STYLIST',
          target_path,
        })
      ).toBe('/app/inbox/session/s1');
    }
  );
  it('rejects external, protocol-relative and recursive targets', () => {
    for (const target_path of [
      'https://example.com',
      '//example.com',
      '/app/notifications/open?id=1',
    ]) {
      expect(notificationTarget({ ...notification, target_path })).toBeNull();
    }
  });
});
