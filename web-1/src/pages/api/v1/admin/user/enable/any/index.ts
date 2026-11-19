import { defineEndpoint } from '@app/http/define-endpoint';
import { USER_CONTRACTS } from '@kernel/domain/user/user.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { adminEnableUserAny_IO } from '@domain/admin/operations/admin-user-management.operations';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineEndpoint(USER_CONTRACTS.USER_ENABLE_ANY, {
  handle: async ({ input: body, ctx, res }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await adminEnableUserAny_IO({
      target_id: body.id,
      currentUser,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(res, undefined, APP_EVENTS.INFO.USER.USER_ENABLED);
  },
});
