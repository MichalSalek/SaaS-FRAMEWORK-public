import { defineEndpoint } from '@app/http/define-endpoint';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminGetLogGroups_IO } from '@domain/admin/operations/admin-log-groups.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';

export default defineEndpoint(ADMIN_CONTRACTS.ADMIN_GET_LOG_GROUPS, {
  handle: async ({ input, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    res.setHeader('Cache-Control', 'no-store');

    const result = await adminGetLogGroups_IO({
      body: {
        ...(input.environment !== undefined && {
          environment: input.environment,
        }),
        ...(input.application !== undefined && {
          application: input.application,
        }),
        ...(input.type !== undefined && { type: input.type }),
        ...(input.attention !== undefined && { attention: input.attention }),
      },
      currentUser,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    ok(result.data, APP_EVENTS.INFO.ADMIN.LOG_GROUPS_FETCHED);
  },
});
