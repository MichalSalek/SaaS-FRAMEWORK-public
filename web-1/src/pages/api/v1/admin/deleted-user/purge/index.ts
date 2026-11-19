import { defineEndpoint } from '@app/http/define-endpoint';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminPurgeDeletedUser_IO } from '@domain/admin/operations/admin-deleted-user.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';

export default defineEndpoint(ADMIN_CONTRACTS.ADMIN_PURGE_DELETED_USER, {
  handle: async ({ input: body, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await adminPurgeDeletedUser_IO({
      user_id: body.user_id,
      currentUser,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    ok(undefined, APP_EVENTS.INFO.USER.USER_DELETED);
  },
});
