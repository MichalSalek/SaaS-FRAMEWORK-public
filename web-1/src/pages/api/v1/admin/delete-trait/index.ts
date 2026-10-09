import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { deleteTrait_IO } from '@domain/admin/operations/admin-traits.operations';
export default defineHandler<
  ADMIN_DTO_API_V1['ADMIN_DELETE_TRAIT']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_DELETE_TRAIT']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.ADMIN.ADMIN_DELETE_TRAIT,
  method: 'post',
  validate: VALIDATION_POLICY.validators.adminDeleteTrait,
  handle: async (body, ctx, _metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await deleteTrait_IO({
      data: { trait_id: body.trait_id },
      currentUser,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(res, { success: true }, APP_EVENTS.INFO.ADMIN.TRAIT_DELETED);
  },
});
