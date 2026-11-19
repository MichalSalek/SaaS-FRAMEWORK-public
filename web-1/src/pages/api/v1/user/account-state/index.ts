import { defineEndpoint } from '@app/http/define-endpoint';
import { USER_CONTRACTS } from '@kernel/domain/user/user.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { getAccountState_IO } from '@domain/user/operations/user-query.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineEndpoint(USER_CONTRACTS.USER_GET_ACCOUNT_STATE, {
  handle: async ({ ctx, res }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await getAccountState_IO({
      userId: currentUser.id,
      roleId: currentUser.role_id,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(res, result.data, APP_EVENTS.INFO.APPLICATION.SUCCESS);
  },
});
