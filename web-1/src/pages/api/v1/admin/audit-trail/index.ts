import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import { adminGetAuditTrail_IO } from '@domain/admin/operations/admin-audit-trail.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { parseQueryParams, pStr, pNum } from '@app/http/parse-query-params';

type RequestParams = ADMIN_DTO_API_V1['ADMIN_GET_AUDIT_TRAIL']['REQUEST'];

const AUDIT_TRAIL_QUERY_SCHEMA = {
  page: pNum,
  limit: pNum,
  event_name: pStr,
} satisfies Record<keyof RequestParams, unknown>;

export default defineHandler<
  ADMIN_DTO_API_V1['ADMIN_GET_AUDIT_TRAIL']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_GET_AUDIT_TRAIL']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.ADMIN.ADMIN_GET_AUDIT_TRAIL,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res, req) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const params = parseQueryParams<RequestParams>(
      req.query,
      AUDIT_TRAIL_QUERY_SCHEMA
    );

    const result = await adminGetAuditTrail_IO({
      currentUser,
      params,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(res, result.data, APP_EVENTS.INFO.ADMIN.AUDIT_TRAIL_FETCHED);
  },
});
