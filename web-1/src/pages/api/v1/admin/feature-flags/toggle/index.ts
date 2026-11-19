import { defineEndpoint } from '@app/http/define-endpoint';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { adminToggleFeatureFlag_IO } from '@domain/admin/operations/admin-feature-flags.operations';

export default defineEndpoint(ADMIN_CONTRACTS.ADMIN_TOGGLE_FEATURE_FLAG, {
  handle: async ({ input: body, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await adminToggleFeatureFlag_IO({
      key: body.key,
      is_enabled: body.is_enabled,
      currentUser,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    ok(result.data, APP_EVENTS.INFO.ADMIN.FEATURE_FLAG_TOGGLED);
  },
});
