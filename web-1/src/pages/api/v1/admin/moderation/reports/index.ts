import { defineEndpoint } from '@app/http/define-endpoint';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { getContentReports_IO } from '@domain/moderation/operations/moderation-reports-list.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { clampInt, PAGINATION_CEILING } from '@app/http/query-params.utils';

export default defineEndpoint(ADMIN_CONTRACTS.ADMIN_GET_CONTENT_REPORTS, {
  handle: async ({ input, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const page = clampInt(input.page, PAGINATION_CEILING, 1);
    const limit = Math.max(1, Math.min(input.limit, 100));

    const result = await getContentReports_IO({
      currentUser,
      params: {
        ...(input.status !== undefined && { status: input.status }),
        page,
        limit,
      },
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    ok(result.data, APP_EVENTS.INFO.ADMIN.CONTENT_REPORTS_FETCHED);
  },
});
