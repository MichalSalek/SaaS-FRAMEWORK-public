import { defineEndpoint } from '@app/http/define-endpoint';
import { USER_CONTRACTS } from '@kernel/domain/user/user.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondSuccess } from '@app/http/http.responses.utils';
import { updateNotificationPreferences_IO } from '@domain/user/operations/user-mutations.operations';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineEndpoint(
  USER_CONTRACTS.USER_UPDATE_NOTIFICATION_PREFERENCES,
  {
    handle: async ({ input: body, ctx, meta: metadata, res }) => {
      const { session, currentUser } = requireAuthenticatedContext(ctx);
      const result = await updateNotificationPreferences_IO({
        user_id: session.userId,
        notifications_enabled: body.notifications_enabled,
      });

      if (!result.success) {
        return mapErrorToResponse(res, result.error);
      }

      // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
      runAfterResponse(() =>
        recordAuditEvent_IO({
          eventName: APP_EVENTS.INFO.USER.NOTIFICATION_PREFERENCES_UPDATED,
          user: currentUser,
          requestBody: body,
          metadata,
        })
      );

      respondSuccess(
        res,
        result.data,
        APP_EVENTS.INFO.USER.NOTIFICATION_PREFERENCES_UPDATED
      );
    },
  }
);
