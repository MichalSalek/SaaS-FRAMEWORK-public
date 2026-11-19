import { defineEndpoint } from '@app/http/define-endpoint';
import { respondOnError } from '@app/http/define-handler';
import { unregisterPushSubscription_IO } from '@domain/notifications/operations/push-subscription.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { NOTIFICATIONS_CONTRACTS } from '@kernel/domain/notifications/notifications.contracts';

// Logout or a switch-off on this device. A foreign endpoint is removed: false.
export default defineEndpoint(
  NOTIFICATIONS_CONTRACTS.PUSH_SUBSCRIPTION_UNREGISTER,
  {
    handle: async ({ input, ctx, res, ok, audit }) => {
      const { currentUser } = requireAuthenticatedContext(ctx);
      const result = await unregisterPushSubscription_IO({
        userId: currentUser.id,
        endpoint: input.endpoint,
      });
      if (respondOnError(res, result)) {
        return;
      }
      if (result.data.removed) {
        audit(APP_EVENTS.INFO.NOTIFICATIONS.PUSH_SUBSCRIPTION_UNREGISTERED, {
          user: { id: currentUser.id },
          requestBody: {},
        });
      }
      ok(
        result.data,
        APP_EVENTS.INFO.NOTIFICATIONS.PUSH_SUBSCRIPTION_UNREGISTERED
      );
    },
  }
);
