import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { updateRolePermissions_IO } from '@domain/admin/operations/admin-permissions.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  ADMIN_DTO_API_V1['ADMIN_UPDATE_PERMISSIONS']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_UPDATE_PERMISSIONS']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.ADMIN.ADMIN_UPDATE_PERMISSIONS,
  method: 'post',
  validate: VALIDATION_POLICY.validators.adminUpdatePermissions,
  handle: async (body, ctx, _metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await updateRolePermissions_IO({
      roleId: body.role_id,
      permissionIds: body.permission_ids,
      currentUser,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(
      res,
      undefined,
      APP_EVENTS.INFO.ADMIN.ADMIN_PERMISSIONS_UPDATED
    );
  },
});
