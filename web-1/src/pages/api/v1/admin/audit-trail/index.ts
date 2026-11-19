import { defineEndpoint } from '@app/http/define-endpoint';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminGetAuditTrail_IO } from '@domain/admin/operations/admin-audit-trail.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';

export default defineEndpoint(ADMIN_CONTRACTS.ADMIN_GET_AUDIT_TRAIL, {
  handle: async ({ input, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await adminGetAuditTrail_IO({
      currentUser,
      params: {
        page: input.page,
        limit: input.limit,
        ...(input.event_name !== undefined && {
          event_name: input.event_name,
        }),
      },
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    ok(result.data, APP_EVENTS.INFO.ADMIN.AUDIT_TRAIL_FETCHED);
  },
});
