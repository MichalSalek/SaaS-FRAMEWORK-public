import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { markSupportThreadRead_IO } from '@domain/support/operations/support-read-marker.operations';
import { markNotificationsReadByKeyPrefix_IO } from '@domain/notifications/operations/notification-write.operations';
import { notificationDedupPrefix } from '@domain/notifications/notification-dedup';
import { NotificationTypeValue } from '@kernel/models/notifications/notifications.dto';
import { SUPPORT_CONTRACTS } from '@kernel/domain/support/support.contracts';
import { requireAuthenticatedContext } from '@domain/user/user.types';

// No audit event: the marker is written every time the owner opens a thread.
export default defineEndpoint(SUPPORT_CONTRACTS.SUPPORT_MARK_THREAD_READ, {
  handle: async ({ input, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await markSupportThreadRead_IO({
      userId: currentUser.id,
      threadId: input.thread_id,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    runAfterResponse(() =>
      markNotificationsReadByKeyPrefix_IO({
        userId: currentUser.id,
        keyPrefix: notificationDedupPrefix(
          NotificationTypeValue.SUPPORT_REPLY_RECEIVED,
          input.thread_id
        ),
      }).then(() => undefined)
    );

    ok(result.data, APP_EVENTS.INFO.SUPPORT.SUPPORT_THREAD_MARKED_READ);
  },
});
