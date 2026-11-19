import { defineEndpoint } from '@app/http/define-endpoint';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { getAdminAttentionCounts_IO } from '@domain/admin/operations/admin-attention.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';

export default defineEndpoint(ADMIN_CONTRACTS.ADMIN_GET_ATTENTION_COUNTS, {
  handle: async ({ ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await getAdminAttentionCounts_IO({ currentUser });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    ok(result.data, APP_EVENTS.INFO.ADMIN.ADMIN_ATTENTION_COUNTS_FETCHED);
  },
});
