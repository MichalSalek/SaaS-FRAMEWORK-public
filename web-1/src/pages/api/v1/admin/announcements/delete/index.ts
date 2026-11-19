import { defineEndpoint } from '@app/http/define-endpoint';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { adminDeleteAnnouncement_IO } from '@domain/admin/operations/admin-announcements.operations';

export default defineEndpoint(ADMIN_CONTRACTS.ADMIN_DELETE_ANNOUNCEMENT, {
  handle: async ({ input: body, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await adminDeleteAnnouncement_IO({
      id: body.id,
      currentUser,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    ok(undefined, APP_EVENTS.INFO.ADMIN.ANNOUNCEMENT_DELETED);
  },
});
