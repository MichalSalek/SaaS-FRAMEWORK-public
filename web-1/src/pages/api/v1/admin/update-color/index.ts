import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { updateColor_IO } from '@domain/admin/operations/admin-colors.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  ADMIN_DTO_API_V1['ADMIN_UPDATE_COLOR']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_UPDATE_COLOR']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.ADMIN.ADMIN_UPDATE_COLOR,
  method: 'post',
  validate: VALIDATION_POLICY.validators.adminUpdateColor,
  handle: async (body, ctx, _metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await updateColor_IO({ data: body, currentUser });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(res, { success: true }, APP_EVENTS.INFO.ADMIN.COLOR_UPDATED);
  },
});
