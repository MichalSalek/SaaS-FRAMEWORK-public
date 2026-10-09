import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { getSupportUnreadCount_IO } from '@domain/support/operations/support-read-marker.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import type { SUPPORT_DTO_API_V1 } from '@kernel/models/support/support.dto';

export default defineHandler<
  SUPPORT_DTO_API_V1['SUPPORT_GET_UNREAD_COUNT']['REQUEST'],
  SUPPORT_DTO_API_V1['SUPPORT_GET_UNREAD_COUNT']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.SUPPORT.SUPPORT_GET_UNREAD_COUNT,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await getSupportUnreadCount_IO(currentUser.id);

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.SUPPORT.SUPPORT_UNREAD_COUNT_FETCHED
    );
  },
});
