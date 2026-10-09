import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminBulkChangePlan_IO } from '@domain/admin/operations/admin-bulk.operations';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  ADMIN_DTO_API_V1['ADMIN_BULK_CHANGE_PLAN']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_BULK_CHANGE_PLAN']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.ADMIN.ADMIN_BULK_CHANGE_PLAN,
  method: 'post',
  validate: VALIDATION_POLICY.validators.adminBulkChangePlan,
  handle: async (body, ctx, _metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await adminBulkChangePlan_IO({
      user_ids: body.user_ids,
      pricing_plan: body.pricing_plan,
      currentUser,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.ADMIN.BULK_CHANGE_PLAN_SUCCESS
    );
  },
});
