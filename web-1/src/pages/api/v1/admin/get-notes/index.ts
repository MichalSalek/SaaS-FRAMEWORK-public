import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import { getNotes_IO } from '@domain/admin/operations/admin-notes.operations';
import { qStr } from '@app/http/query-params.utils';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  ADMIN_DTO_API_V1['GET_NOTES']['REQUEST'],
  ADMIN_DTO_API_V1['GET_NOTES']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.ADMIN.GET_NOTES,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res, req) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    res.setHeader('Cache-Control', 'no-store');

    const requestedId = qStr(req.query, 'id') ?? undefined;

    const result = await getNotes_IO({ requestedId, currentUser });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(res, result.data, APP_EVENTS.INFO.ADMIN.NOTES_FETCHED);
  },
});
