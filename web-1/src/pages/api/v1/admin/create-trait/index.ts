import { defineEndpoint } from '@app/http/define-endpoint';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import { createTrait_IO } from '@domain/admin/operations/admin-traits.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineEndpoint(ADMIN_CONTRACTS.ADMIN_CREATE_TRAIT, {
  handle: async ({ input: body, ctx, res, created }) => {
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
    created(responsePayload, APP_EVENTS.INFO.ADMIN.TRAIT_CREATED);
  },
});
