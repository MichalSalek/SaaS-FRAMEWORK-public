import { defineEndpoint } from '@app/http/define-endpoint';
import { respondOnError } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { NOTIFICATIONS_CONTRACTS } from '@kernel/domain/notifications/notifications.contracts';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { getOneNotification_IO } from '@domain/notifications/operations/notification-query.operations';

export default defineEndpoint(NOTIFICATIONS_CONTRACTS.NOTIFICATIONS_GET_ONE, {
  handle: async ({ input, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await getOneNotification_IO(
      currentUser.id,
      input.id ?? '',
      input.notification_schema
    );
    if (respondOnError(res, result)) {
      return;
    }
    res.setHeader('Cache-Control', 'private, no-store');
    ok(result.data, APP_EVENTS.INFO.NOTIFICATIONS.NOTIFICATION_FETCHED);
  },
});
