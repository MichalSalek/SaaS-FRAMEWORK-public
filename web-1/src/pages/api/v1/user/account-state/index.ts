import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { getAccountState_IO } from '@domain/user/operations/user-query.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  USER_DTO_API_V1['USER_GET_ACCOUNT_STATE']['REQUEST'],
  USER_DTO_API_V1['USER_GET_ACCOUNT_STATE']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.USER.USER_GET_ACCOUNT_STATE,
  method: 'get',
  validate: VALIDATION_POLICY.validators.userGetAccountState,
  handle: async (_body, ctx, _metadata, res) => {
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
