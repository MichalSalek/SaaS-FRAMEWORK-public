import { defineEndpoint } from '@app/http/define-endpoint';
import { respondOnError } from '@app/http/define-handler';
import { markNotificationsRead_IO } from '@domain/notifications/operations/notification-write.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { NOTIFICATIONS_CONTRACTS } from '@kernel/domain/notifications/notifications.contracts';

// Opening the list marks rows up to newest_seen_at. A later row stays unread.
// Not audited: a read marker is not an account event.
export default defineEndpoint(NOTIFICATIONS_CONTRACTS.NOTIFICATIONS_MARK_READ, {
  handle: async ({ input, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await markNotificationsRead_IO({
      userId: currentUser.id,
      accountType: currentUser.account_type,
      ...(input.newest_seen_at
        ? { newestSeenAt: new Date(input.newest_seen_at) }
        : {}),
      ...(input.notification_id
        ? { notificationId: input.notification_id }
        : {}),
    });
    if (respondOnError(res, result)) {
      return;
    }
    ok(result.data, APP_EVENTS.INFO.NOTIFICATIONS.NOTIFICATIONS_MARKED_READ);
  },
});
