import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { savePolicy_IO } from '@domain/admin/operations/admin-policies.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  ADMIN_DTO_API_V1['ADMIN_SAVE_POLICY']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_SAVE_POLICY']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.ADMIN.ADMIN_SAVE_POLICY,
  method: 'post',
  validate: VALIDATION_POLICY.validators.adminSavePolicy,
  handle: async (body, ctx, _metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await savePolicy_IO({
      data: {
        ...(body.id !== undefined && { id: body.id }),
        title: body.title,
        content: body.content,
      },
      currentUser,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(res, result.data, APP_EVENTS.INFO.ADMIN.POLICY_SAVED);
  },
});
