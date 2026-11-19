import { defineEndpoint } from '@app/http/define-endpoint';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminSwitchBackendDebugMode_IO } from '@domain/admin/operations/admin-debug.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineEndpoint(ADMIN_CONTRACTS.SWITCH_BACKEND_DEBUG_MODE, {
  handle: async ({ input: body, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await adminSwitchBackendDebugMode_IO({
      body,
      currentUser,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    ok(result.data, result.data.event);
  },
});
