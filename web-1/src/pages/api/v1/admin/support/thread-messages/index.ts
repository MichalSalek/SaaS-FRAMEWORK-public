import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import {
  respondSuccess,
  respondValidationFailed,
} from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminGetThreadMessages_IO } from '@domain/support/operations/support-admin.operations';
import type { SUPPORT_DTO_API_V1 } from '@kernel/models/support/support.dto';
import { qStr } from '@app/http/query-params.utils';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  SUPPORT_DTO_API_V1['SUPPORT_ADMIN_GET_THREAD_MESSAGES']['REQUEST'],
  SUPPORT_DTO_API_V1['SUPPORT_ADMIN_GET_THREAD_MESSAGES']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.SUPPORT.SUPPORT_ADMIN_GET_THREAD_MESSAGES,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res, req) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const thread_id = qStr(req.query, 'thread_id');
    if (!thread_id) {
      respondValidationFailed(res, { thread_id: 'Required' });
      return;
    }

    const result = await adminGetThreadMessages_IO(thread_id, currentUser);

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.SUPPORT.SUPPORT_ADMIN_MESSAGES_FETCHED
    );
  },
});
