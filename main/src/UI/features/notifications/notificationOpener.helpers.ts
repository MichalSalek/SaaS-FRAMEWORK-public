import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import type { NotificationDTO } from '@kernel/models/notifications/notifications.dto';
import { buildRoute } from '../../../application/routing/buildRoute';
import { isInternalPageHref } from '../../../application/routing/page-href';

const conversationPrefix = buildRoute(ROUTES_FRONT.MESSAGES_THREAD, {
  pairId: '',
});

function isConversationTarget(target: string): boolean {
  if (!isInternalPageHref(target) || !target.startsWith(conversationPrefix)) {
    return false;
  }
  const pairId = target.slice(conversationPrefix.length);
  return (
    pairId !== '' &&
    buildRoute(ROUTES_FRONT.MESSAGES_THREAD, { pairId }) === target
  );
}

/** The server verifies ownership. Never navigate to an external or recursive URL. */
export function notificationTarget(
  notification: NotificationDTO
): string | null {
  if (notification.activity_kind?.startsWith('SESSION_')) {
    if (!notification.session_id || !notification.recipient_role) {
      return null;
    }
    // New activity notifications open the conversation containing the session
    // card. Historical notifications keep their role-specific session fallback.
    if (isConversationTarget(notification.target_path)) {
      return notification.target_path;
    }
    return buildRoute(
      notification.recipient_role === 'STYLIST'
        ? ROUTES_FRONT.SESSION_DETAIL
        : ROUTES_FRONT.CLIENT_SESSION_DETAIL,
      { sessionId: notification.session_id }
    );
  }
  const target = notification.target_path;
  if (
    !isInternalPageHref(target) ||
    target.startsWith(ROUTES_FRONT.NOTIFICATION_OPEN)
  ) {
    return null;
  }
  return target;
}
