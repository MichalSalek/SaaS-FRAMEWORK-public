import { defineEndpoint } from '@app/http/define-endpoint';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { getAllPermissions_IO } from '@domain/admin/operations/admin-permissions.operations';
import type { z } from 'zod';
import type { permissionsResponseSchema } from '@kernel/domain/admin/admin-response.contract-schemas';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineEndpoint(ADMIN_CONTRACTS.ADMIN_GET_PERMISSIONS, {
  handle: async ({ ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await getAllPermissions_IO({ currentUser });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // The operation types both lists as unknown[]. The rows are the permission
    // projection; the contract guard checks the wire in tests and development.
    const data = result.data as z.infer<typeof permissionsResponseSchema>;
    ok(data, APP_EVENTS.INFO.ADMIN.ADMIN_PERMISSIONS_FETCHED);
  },
});
