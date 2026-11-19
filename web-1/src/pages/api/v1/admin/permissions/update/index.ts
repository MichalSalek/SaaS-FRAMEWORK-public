import { defineEndpoint } from '@app/http/define-endpoint';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { updateRolePermissions_IO } from '@domain/admin/operations/admin-permissions.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineEndpoint(ADMIN_CONTRACTS.ADMIN_UPDATE_PERMISSIONS, {
  handle: async ({ input: body, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await updateRolePermissions_IO({
      roleId: body.role_id,
      permissionIds: body.permission_ids,
      currentUser,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    ok(undefined, APP_EVENTS.INFO.ADMIN.ADMIN_PERMISSIONS_UPDATED);
  },
});
