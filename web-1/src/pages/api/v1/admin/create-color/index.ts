import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondCreated } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { createColor_IO } from '@domain/admin/operations/admin-colors.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  ADMIN_DTO_API_V1['ADMIN_CREATE_COLOR']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_CREATE_COLOR']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.ADMIN.ADMIN_CREATE_COLOR,
  method: 'post',
  validate: VALIDATION_POLICY.validators.adminCreateColor,
  handle: async (body, ctx, _metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await createColor_IO({
      data: {
        name: body.name,
        hex_code: body.hex_code,
        ...(body.display_order !== undefined && {
          display_order: body.display_order,
        }),
      },
      currentUser,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondCreated(
      res,
      { color_id: result.data.id },
      APP_EVENTS.INFO.ADMIN.COLOR_CREATED
    );
  },
});
