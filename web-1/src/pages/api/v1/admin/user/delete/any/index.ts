import { defineEndpoint } from '@app/http/define-endpoint';
import { USER_CONTRACTS } from '@kernel/domain/user/user.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminDeleteUserAny_IO } from '@domain/admin/operations/admin-user-management.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineEndpoint(USER_CONTRACTS.USER_DELETE_ANY, {
  handle: async ({ input: body, ctx, res }) => {
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
