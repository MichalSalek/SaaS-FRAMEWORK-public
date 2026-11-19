import { defineEndpoint } from '@app/http/define-endpoint';
import { respondOnError } from '@app/http/define-handler';
import { getUnreadNotificationsCount_IO } from '@domain/notifications/operations/notification-query.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { NOTIFICATIONS_CONTRACTS } from '@kernel/domain/notifications/notifications.contracts';

// The bell's badge: polled, so it stays a single indexed COUNT.
export default defineEndpoint(
  NOTIFICATIONS_CONTRACTS.NOTIFICATIONS_GET_UNREAD_COUNT,
  {
    handle: async ({ ctx, res, ok }) => {
      const { currentUser } = requireAuthenticatedContext(ctx);
      const result = await getUnreadNotificationsCount_IO({
        userId: currentUser.id,
        accountType: currentUser.account_type,
      });
      if (respondOnError(res, result)) {
        return;
      }
      ok(
        result.data,
        APP_EVENTS.INFO.NOTIFICATIONS.NOTIFICATIONS_UNREAD_COUNT_FETCHED
      );
    },
  }
);
