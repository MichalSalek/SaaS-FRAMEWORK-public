import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminGetLogDetails_IO } from '@domain/admin/operations/admin-log-details.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import { parseQueryParams, pNum } from '@app/http/parse-query-params';

type RequestParams = ADMIN_DTO_API_V1['ADMIN_GET_LOG_DETAILS']['REQUEST'];

const LOG_DETAILS_QUERY_SCHEMA = {
  id: pNum,
} satisfies Record<keyof RequestParams, unknown>;

export default defineHandler<
  RequestParams,
  ADMIN_DTO_API_V1['ADMIN_GET_LOG_DETAILS']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.ADMIN.ADMIN_GET_LOG_DETAILS,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res, req) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    res.setHeader('Cache-Control', 'no-store');

    const parsed = parseQueryParams<RequestParams>(
      req.query,
      LOG_DETAILS_QUERY_SCHEMA,
      { base: { id: Number.NaN } }
    );

    const result = await adminGetLogDetails_IO({
      body: parsed,
      currentUser,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(res, result.data, APP_EVENTS.INFO.ADMIN.LOG_DETAILS_FETCHED);
  },
});
