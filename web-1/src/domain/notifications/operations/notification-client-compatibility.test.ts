import { parseAnnouncementLinks } from '@kernel/domain/admin/announcement-links';
import { describe, expect, it } from 'vitest';
import type { NotificationDTO } from '@kernel/models/notifications/notifications.dto';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { notificationRowSchema } from '@kernel/domain/notifications/notifications.contract-schemas';
import { notificationForClient } from './notification-client-compatibility';

const reminder: NotificationDTO = {
  id: 'reminder/id',
  type: 'SESSION_EXPIRING_SOON',
  actor_name: 'Anna',
  target_path: '/app/sessions/session-1',
  recipient_role: 'CLIENT',
  created_at: '2026-11-08T20:00:00.000Z',
  read_at: null,
};

describe('notification wire compatibility', () => {
  it('keeps the new type only for an explicitly capable client', () => {
    expect(notificationForClient(reminder, '2')).toBe(reminder);
    expect(notificationForClient(reminder).type).toBe('SYSTEM_ANNOUNCEMENT');
  });
  it('preserves role, target and read-marker identity while giving old tabs translated copy', () => {
    const wire = notificationForClient(reminder);
    expect(wire).toMatchObject({ ...reminder, type: 'SYSTEM_ANNOUNCEMENT' });
    expect(wire.announcement?.primary_href).toBeNull();
    for (const locale of ['pl', 'en', 'de'] as const) {
      expect(wire.announcement?.translations[locale]?.title).toBeTruthy();
      const message = wire.announcement?.translations[locale]?.message ?? '';
      expect(
        parseAnnouncementLinks(message).some(
          part =>
            part.href === `${ROUTES_FRONT.NOTIFICATION_OPEN}?id=reminder%2Fid`
        )
      ).toBe(true);
    }
    expect(notificationRowSchema.safeParse(wire).success).toBe(true);
  });
  it('does not alter existing announcements or other notification types', () => {
    const existing: NotificationDTO = { ...reminder, type: 'MESSAGE_RECEIVED' };
    expect(notificationForClient(existing)).toBe(existing);
  });
});
