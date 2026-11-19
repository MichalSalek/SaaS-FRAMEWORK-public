import { defineEndpoint } from '@app/http/define-endpoint';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminChangePricingPlan_IO } from '@domain/admin/operations/admin-user-management.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineEndpoint(ADMIN_CONTRACTS.ADMIN_CHANGE_PRICING_PLAN, {
  handle: async ({ input: body, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await adminChangePricingPlan_IO({
      target_id: body.id,
      pricing_plan: body.pricing_plan,
      currentUser,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    ok(undefined, APP_EVENTS.INFO.ADMIN.ADMIN_PRICING_PLAN_CHANGED);
  },
});
