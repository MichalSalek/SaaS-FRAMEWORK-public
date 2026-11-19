import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { getSupportUnreadCount_IO } from '@domain/support/operations/support-read-marker.operations';
import { SUPPORT_CONTRACTS } from '@kernel/domain/support/support.contracts';
import { requireAuthenticatedContext } from '@domain/user/user.types';

export default defineEndpoint(SUPPORT_CONTRACTS.SUPPORT_GET_UNREAD_COUNT, {
  handle: async ({ ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await getSupportUnreadCount_IO(currentUser.id);

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    ok(result.data, APP_EVENTS.INFO.SUPPORT.SUPPORT_UNREAD_COUNT_FETCHED);
  },
});
