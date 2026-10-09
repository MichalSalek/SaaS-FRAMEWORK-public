import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { adminToggleFeatureFlag_IO } from '@domain/admin/operations/admin-feature-flags.operations';

type ToggleRequest = ADMIN_DTO_API_V1['ADMIN_TOGGLE_FEATURE_FLAG']['REQUEST'];
export default defineHandler<
  ToggleRequest,
  ADMIN_DTO_API_V1['ADMIN_TOGGLE_FEATURE_FLAG']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.ADMIN.ADMIN_TOGGLE_FEATURE_FLAG,
  method: 'post',
  validate: VALIDATION_POLICY.validators.adminToggleFeatureFlag,
  handle: async (body, ctx, _metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await adminToggleFeatureFlag_IO({
      key: body.key,
      is_enabled: body.is_enabled,
      currentUser,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.ADMIN.FEATURE_FLAG_TOGGLED
    );
  },
});
