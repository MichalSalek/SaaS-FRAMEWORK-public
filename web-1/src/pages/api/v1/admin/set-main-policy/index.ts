import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { setMainPolicy_IO } from '@domain/admin/operations/admin-policies.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  ADMIN_DTO_API_V1['ADMIN_SET_MAIN_POLICY']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_SET_MAIN_POLICY']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.ADMIN.ADMIN_SET_MAIN_POLICY,
  method: 'post',
  validate: VALIDATION_POLICY.validators.adminSetMainPolicy,
  handle: async (body, ctx, _metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await setMainPolicy_IO({
      data: { id: body.id },
      currentUser,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(res, undefined, APP_EVENTS.INFO.ADMIN.POLICY_SET_MAIN);
  },
});
