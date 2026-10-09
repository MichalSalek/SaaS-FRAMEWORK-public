import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminGetReports_IO } from '@domain/admin/operations/admin-reports.operations';
import type {
  ADMIN_DTO_API_V1,
  ReportPeriod,
} from '@kernel/models/admin/admin.dto';
import { parseQueryParams, pOneOf } from '@app/http/parse-query-params';
import { requireAuthenticatedContext } from '@domain/user/user.types';

type RequestParams = ADMIN_DTO_API_V1['ADMIN_GET_REPORTS']['REQUEST'];

const VALID_PERIODS: readonly ReportPeriod[] = ['week', 'month', 'quarter'];

const REPORTS_QUERY_SCHEMA = {
  // Default to 'month' if invalid or missing.
  period: pOneOf(VALID_PERIODS, 'month'),
} satisfies Record<keyof RequestParams, unknown>;

export default defineHandler({
  eventName: APP_EVENTS.QUERIES.ADMIN.ADMIN_GET_REPORTS,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res, req) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const params = parseQueryParams<RequestParams>(
      req.query,
      REPORTS_QUERY_SCHEMA
    );

    const result = await adminGetReports_IO({ currentUser, params });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(res, result.data, APP_EVENTS.INFO.ADMIN.REPORTS_FETCHED);
  },
});
