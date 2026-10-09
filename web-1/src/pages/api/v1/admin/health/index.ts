import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminGetHealth_IO } from '@domain/admin/operations/admin-health.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler({
  eventName: APP_EVENTS.QUERIES.ADMIN.ADMIN_HEALTH,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await adminGetHealth_IO({ currentUser });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.ADMIN.ADMIN_HEALTH_FETCHED
    );
  },
});
