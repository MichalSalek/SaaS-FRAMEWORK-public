import { defineEndpoint } from '@app/http/define-endpoint';
import { respondOnError } from '@app/http/define-handler';
import { getRecentNotifications_IO } from '@domain/notifications/operations/notification-query.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { NOTIFICATIONS_CONTRACTS } from '@kernel/domain/notifications/notifications.contracts';

// Notification centre: newest rows of the caller in her ACTIVE role plus
// role-less ones (salon invitations). No account guard: both roles read it.
export default defineEndpoint(
  NOTIFICATIONS_CONTRACTS.NOTIFICATIONS_GET_RECENT,
  {
    handle: async ({ input, ctx, res, ok }) => {
      const { currentUser } = requireAuthenticatedContext(ctx);
      const result = await getRecentNotifications_IO({
        userId: currentUser.id,
        accountType: currentUser.account_type,
        notificationSchema: input.notification_schema,
      });
      if (respondOnError(res, result)) {
        return;
      }
      ok(result.data, APP_EVENTS.INFO.NOTIFICATIONS.NOTIFICATIONS_FETCHED);
    },
  }
);
