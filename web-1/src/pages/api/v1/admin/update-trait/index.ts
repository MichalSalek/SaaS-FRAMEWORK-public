import { defineEndpoint } from '@app/http/define-endpoint';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { updateTrait_IO } from '@domain/admin/operations/admin-traits.operations';
export default defineEndpoint(ADMIN_CONTRACTS.ADMIN_UPDATE_TRAIT, {
  handle: async ({ input: body, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await updateTrait_IO({ data: body, currentUser });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    ok({ success: true }, APP_EVENTS.INFO.ADMIN.TRAIT_UPDATED);
  },
});
