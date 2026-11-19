import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import type { NotificationDTO } from '@kernel/models/notifications/notifications.dto';
import { renderNotificationCopy } from '@kernel/domain/notifications/notification-copy.config';

/** Old open tabs cannot render a newly introduced notification enum member.
 * Adapt the wire only; storage, deduplication, roles and read markers stay canonical. */
export function notificationForClient(
  notification: NotificationDTO,
  schema?: string
): NotificationDTO {
  if (schema === '2' || notification.type !== 'SESSION_EXPIRING_SOON') {
    return notification;
  }
  const href = `${ROUTES_FRONT.NOTIFICATION_OPEN}?id=${encodeURIComponent(notification.id)}`;
  const translation = (locale: 'pl' | 'en' | 'de') => {
    const copy = renderNotificationCopy(
      locale,
      notification.type,
      notification.actor_name
    );
    return { title: copy.title, message: `[${copy.body}](${href})` };
  };
  return {
    ...notification,
    type: 'SYSTEM_ANNOUNCEMENT',
    announcement: {
      translations: {
        pl: translation('pl'),
        en: translation('en'),
        de: translation('de'),
      },
      primary_href: null,
    },
  };
}
