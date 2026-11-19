import { defineEndpoint } from '@app/http/define-endpoint';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { createColor_IO } from '@domain/admin/operations/admin-colors.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineEndpoint(ADMIN_CONTRACTS.ADMIN_CREATE_COLOR, {
  handle: async ({ input: body, ctx, res, created }) => {
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

    created({ color_id: result.data.id }, APP_EVENTS.INFO.ADMIN.COLOR_CREATED);
  },
});
