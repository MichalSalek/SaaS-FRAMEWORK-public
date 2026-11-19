import { defineEndpoint } from '@app/http/define-endpoint';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import {
  pushAnnouncementNotification_IO,
  sendAnnouncementNotification_IO,
} from '@domain/admin/operations/announcement-notification.operations';

export default defineEndpoint(
  ADMIN_CONTRACTS.ADMIN_SEND_ANNOUNCEMENT_NOTIFICATION,
  {
    handle: async ({ input, ctx, res, ok, audit }) => {
      const { currentUser } = requireAuthenticatedContext(ctx);
      const result = await sendAnnouncementNotification_IO({
        id: input.id,
        currentUser,
      });
      if (!result.success) {
        return mapErrorToResponse(res, result.error);
      }
      if (result.data.created) {
        audit(APP_EVENTS.INFO.ADMIN.ANNOUNCEMENT_UPDATED, {
          user: { id: currentUser.id },
          requestBody: { id: input.id, action: 'SEND_NOTIFICATION' },
        });
        runAfterResponse(() => pushAnnouncementNotification_IO(result.data));
      }
      ok(
        { notification_sent_at: result.data.sentAt },
        APP_EVENTS.INFO.APPLICATION.SUCCESS
      );
    },
  }
);
