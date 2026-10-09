import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';
import { NO_VALIDATION } from '@kernel/policies/validation.policy';
import { exportUserData_IO } from '@domain/user/operations/export-user-data.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  USER_DTO_API_V1['USER_EXPORT_DATA']['REQUEST'],
  USER_DTO_API_V1['USER_EXPORT_DATA']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.USER.USER_EXPORT_DATA,
  method: 'post',
  validate: NO_VALIDATION,
  handle: async (_body, ctx, _metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await exportUserData_IO({ currentUser });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(res, result.data, APP_EVENTS.INFO.USER.USER_DATA_EXPORTED);
  },
});
