import { defineEndpoint } from '@app/http/define-endpoint';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminGetUserTimeline_IO } from '@domain/admin/operations/admin-user-timeline.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';

export default defineEndpoint(ADMIN_CONTRACTS.ADMIN_GET_USER_TIMELINE, {
  handle: async ({ input, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await adminGetUserTimeline_IO({
      currentUser,
      params: {
        user_id: input.user_id ?? '',
        page: input.page,
        limit: input.limit,
        ...(input.event_type !== undefined && {
          event_type: input.event_type,
        }),
      },
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    ok(result.data, APP_EVENTS.INFO.ADMIN.USER_TIMELINE_FETCHED);
  },
});
