import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminGetAllThreads_IO } from '@domain/support/operations/support-admin.operations';
import { SUPPORT_CONTRACTS } from '@kernel/domain/support/support.contracts';
import { requireAuthenticatedContext } from '@domain/user/user.types';

export default defineEndpoint(SUPPORT_CONTRACTS.SUPPORT_ADMIN_GET_ALL_THREADS, {
  handle: async ({ input, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    // Unknown status/category already decoded as absent. Only the literal true turns the
    // awaiting-reply predicate on (false and a missing key do not).
    const result = await adminGetAllThreads_IO(
      currentUser,
      {
        status: input.status,
        category: input.category,
        awaitingReply: input.awaiting_reply === true,
      },
      { cursor: input.cursor, take: input.take }
    );

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    ok(result.data, APP_EVENTS.INFO.SUPPORT.SUPPORT_ADMIN_THREADS_FETCHED);
  },
});
