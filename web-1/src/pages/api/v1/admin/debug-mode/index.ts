import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminSwitchBackendDebugMode_IO } from '@domain/admin/operations/admin-debug.operations';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  ADMIN_DTO_API_V1['SWITCH_BACKEND_DEBUG_MODE']['REQUEST'],
  ADMIN_DTO_API_V1['SWITCH_BACKEND_DEBUG_MODE']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.ADMIN.SWITCH_BACKEND_DEBUG_MODE,
  method: 'post',
  validate: VALIDATION_POLICY.validators.adminDebugMode,
  handle: async (body, ctx, _metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await adminSwitchBackendDebugMode_IO({
      body,
      currentUser,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(res, result.data, result.data.event);
  },
});
