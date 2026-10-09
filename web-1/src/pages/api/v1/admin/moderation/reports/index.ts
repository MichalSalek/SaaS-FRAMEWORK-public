import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { getContentReports_IO } from '@domain/moderation/operations/moderation-reports-list.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import {
  qStr,
  qInt,
  clampInt,
  PAGINATION_CEILING,
} from '@app/http/query-params.utils';
import {
  CONTENT_REPORT_STATUSES,
  type ContentReportStatus,
  type MODERATION_DTO_API_V1,
} from '@kernel/models/moderation/moderation.dto';
// C3 (K1): <REQUEST, RESPONSE> brand — RESPONSE degradowal do unknown bez type-paramow,
// wiec respondSuccess nie wymuszal data == RESPONSE_DTO (over-return resolved_by_id przeszedl
// niezauwazony). Brand + explicit field-pick w operacji domykaja drift compile-time.
export default defineHandler<
  MODERATION_DTO_API_V1['ADMIN_GET_CONTENT_REPORTS']['REQUEST'],
  MODERATION_DTO_API_V1['ADMIN_GET_CONTENT_REPORTS']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.ADMIN.ADMIN_GET_CONTENT_REPORTS,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res, req) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const statusParam = qStr(req.query, 'status');
    const status: ContentReportStatus | undefined =
      statusParam &&
      (CONTENT_REPORT_STATUSES as readonly string[]).includes(statusParam)
        ? (statusParam as ContentReportStatus)
        : undefined;

    // Clamp page to [1, PAGINATION_CEILING] so a huge client-supplied page can't
    // make the operation's skip = (page-1)*limit overflow Postgres bigint OFFSET
    // (-> unmapped HTTP 500). Past-end page yields an empty list (200).
    const page = clampInt(qInt(req.query, 'page') ?? 1, PAGINATION_CEILING, 1);
    const limit = Math.max(1, Math.min(qInt(req.query, 'limit') ?? 20, 100));

    const result = await getContentReports_IO({
      currentUser,
      params: { status, page, limit },
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.ADMIN.CONTENT_REPORTS_FETCHED
    );
  },
});
