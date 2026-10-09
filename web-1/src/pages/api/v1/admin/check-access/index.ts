import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { checkAccessHealth_IO } from '@domain/admin/operations/admin-check-access.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
export default defineHandler<
  undefined,
  ADMIN_DTO_API_V1['ADMIN_CHECK_ACCESS_HEALTH']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.ADMIN.ADMIN_CHECK_ACCESS_HEALTH,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await checkAccessHealth_IO({ currentUser });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.ADMIN.ADMIN_CHECK_ACCESS_HEALTH_FETCHED
    );
  },
});
