import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondCreated } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { createTrait_IO } from '@domain/admin/operations/admin-traits.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  ADMIN_DTO_API_V1['ADMIN_CREATE_TRAIT']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_CREATE_TRAIT']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.ADMIN.ADMIN_CREATE_TRAIT,
  method: 'post',
  validate: VALIDATION_POLICY.validators.adminCreateTrait,
  handle: async (body, ctx, _metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await createTrait_IO({
      data: {
        name: body.name,
        category: body.category,
        ...(body.icon_url !== undefined && { icon_url: body.icon_url }),
        ...(body.display_order !== undefined && {
          display_order: body.display_order,
        }),
        ...(body.is_featured !== undefined && {
          is_featured: body.is_featured,
        }),
      },
      currentUser,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    const responsePayload: ADMIN_DTO_API_V1['ADMIN_CREATE_TRAIT']['RESPONSE'] =
      {
        trait_id: result.data.id,
      };
    respondCreated(res, responsePayload, APP_EVENTS.INFO.ADMIN.TRAIT_CREATED);
  },
});
