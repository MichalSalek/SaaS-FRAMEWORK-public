import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { deleteColor_IO } from '@domain/admin/operations/admin-colors.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  ADMIN_DTO_API_V1['ADMIN_DELETE_COLOR']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_DELETE_COLOR']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.ADMIN.ADMIN_DELETE_COLOR,
  method: 'post',
  validate: VALIDATION_POLICY.validators.adminDeleteColor,
  handle: async (body, ctx, _metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await deleteColor_IO({
      data: { color_id: body.color_id },
      currentUser,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(res, { success: true }, APP_EVENTS.INFO.ADMIN.COLOR_DELETED);
  },
});
