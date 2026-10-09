import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminGetMetrics_IO } from '@domain/admin/operations/admin-metrics.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler({
  eventName: APP_EVENTS.QUERIES.ADMIN.ADMIN_GET_METRICS,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await adminGetMetrics_IO({ currentUser });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.ADMIN.ADMIN_METRICS_FETCHED
    );
  },
});
