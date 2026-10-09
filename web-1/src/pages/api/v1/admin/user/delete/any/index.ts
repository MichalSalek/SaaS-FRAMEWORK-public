import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminDeleteUserAny_IO } from '@domain/admin/operations/admin-user-management.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
export default defineHandler<
  ADMIN_DTO_API_V1['USER_DELETE_ANY']['REQUEST'],
  ADMIN_DTO_API_V1['USER_DELETE_ANY']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.USER.USER_DELETE_ANY,
  method: 'post',
  validate: VALIDATION_POLICY.validators.deleteOrDisableOtherUser,
  handle: async (body, ctx, _metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await adminDeleteUserAny_IO({
      target_id: body.id,
      currentUser,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(res, undefined, APP_EVENTS.INFO.USER.USER_DELETED);
  },
});
