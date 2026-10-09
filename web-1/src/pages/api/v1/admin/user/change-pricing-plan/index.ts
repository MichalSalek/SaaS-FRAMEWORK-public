import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminChangePricingPlan_IO } from '@domain/admin/operations/admin-user-management.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
export default defineHandler<
  ADMIN_DTO_API_V1['ADMIN_CHANGE_PRICING_PLAN']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_CHANGE_PRICING_PLAN']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.ADMIN.ADMIN_CHANGE_PRICING_PLAN,
  method: 'post',
  validate: VALIDATION_POLICY.validators.adminChangePricingPlan,
  handle: async (body, ctx, _metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await adminChangePricingPlan_IO({
      target_id: body.id,
      pricing_plan: body.pricing_plan,
      currentUser,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(
      res,
      undefined,
      APP_EVENTS.INFO.ADMIN.ADMIN_PRICING_PLAN_CHANGED
    );
  },
});
