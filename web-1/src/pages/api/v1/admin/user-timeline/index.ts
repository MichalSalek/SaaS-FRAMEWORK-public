import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import { adminGetUserTimeline_IO } from '@domain/admin/operations/admin-user-timeline.operations';
import {
  parseQueryParams,
  pStr,
  pNum,
  pNarrowed,
} from '@app/http/parse-query-params';
import { isEventLogTypeNarrower } from '@kernel/models/type_narrowing';
import { requireAuthenticatedContext } from '@domain/user/user.types';

type RequestParams = ADMIN_DTO_API_V1['ADMIN_GET_USER_TIMELINE']['REQUEST'];

const USER_TIMELINE_QUERY_SCHEMA = {
  // `user_id` is required: defaulted to '' via `base`, overridden when present.
  user_id: pStr,
  page: pNum,
  limit: pNum,
  event_type: pNarrowed(isEventLogTypeNarrower),
} satisfies Record<keyof RequestParams, unknown>;

export default defineHandler<
  ADMIN_DTO_API_V1['ADMIN_GET_USER_TIMELINE']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_GET_USER_TIMELINE']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.ADMIN.ADMIN_GET_USER_TIMELINE,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res, req) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const params = parseQueryParams<RequestParams>(
      req.query,
      USER_TIMELINE_QUERY_SCHEMA,
      { base: { user_id: '' } }
    );

    const result = await adminGetUserTimeline_IO({
      currentUser,
      params,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.ADMIN.USER_TIMELINE_FETCHED
    );
  },
});
