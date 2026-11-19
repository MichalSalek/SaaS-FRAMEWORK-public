import { defineEndpoint } from '@app/http/define-endpoint';
import { respondOnError } from '@app/http/define-handler';
import { redactAuditPayload } from '@app/event-log/event-log-io.wrapper';
import { registerPushSubscription_IO } from '@domain/notifications/operations/push-subscription.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { NOTIFICATION_CONFIG } from '@kernel/domain/notifications/notification.config';
import { NOTIFICATIONS_CONTRACTS } from '@kernel/domain/notifications/notifications.contracts';

// A device of the caller. The account switch is read at send time, not here.
// The audit row keeps the platform only, never the endpoint.
export default defineEndpoint(
  NOTIFICATIONS_CONTRACTS.PUSH_SUBSCRIPTION_REGISTER,
  {
    handle: async ({ input, ctx, req, res, ok, audit }) => {
      const { currentUser } = requireAuthenticatedContext(ctx);
      const userAgentHeader = req.headers['user-agent'];
      const userAgent =
        typeof userAgentHeader === 'string'
          ? userAgentHeader.slice(
              0,
              NOTIFICATION_CONFIG.PUSH_ENDPOINT_MAX_LENGTH / 4
            )
          : null;
      const result = await registerPushSubscription_IO({
        userId: currentUser.id,
        platform: input.platform,
        endpoint: input.endpoint,
        p256dh: input.p256dh ?? null,
        auth: input.auth ?? null,
        userAgent,
      });
      if (respondOnError(res, result)) {
        return;
      }
      audit(APP_EVENTS.INFO.NOTIFICATIONS.PUSH_SUBSCRIPTION_REGISTERED, {
        user: { id: currentUser.id },
        requestBody: redactAuditPayload(input, ['platform']),
      });
      ok(
        result.data,
        APP_EVENTS.INFO.NOTIFICATIONS.PUSH_SUBSCRIPTION_REGISTERED
      );
    },
  }
);
