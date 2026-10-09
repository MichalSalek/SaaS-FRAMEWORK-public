import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { updateRuntimeConfig_IO } from '@domain/admin/operations/admin-runtime-config.operations';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  ADMIN_DTO_API_V1['ADMIN_UPDATE_CONFIG']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_UPDATE_CONFIG']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.ADMIN.ADMIN_UPDATE_CONFIG,
  method: 'post',
  validate: VALIDATION_POLICY.validators.adminUpdateConfig,
  handle: async (body, ctx, _metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await updateRuntimeConfig_IO({
      currentUser,
      params: body,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(res, result.data, APP_EVENTS.INFO.ADMIN.CONFIG_UPDATED);
  },
});
