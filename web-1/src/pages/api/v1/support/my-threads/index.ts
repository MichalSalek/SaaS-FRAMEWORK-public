import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { getSupportThreads_IO } from '@domain/support/operations/support-thread-queries.operations';
import { SUPPORT_CONTRACTS } from '@kernel/domain/support/support.contracts';
import { requireAuthenticatedContext } from '@domain/user/user.types';

export default defineEndpoint(SUPPORT_CONTRACTS.SUPPORT_GET_MY_THREADS, {
  handle: async ({ input, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await getSupportThreads_IO(currentUser.id, {
      cursor: input.cursor,
      take: input.take,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    ok(result.data, APP_EVENTS.INFO.SUPPORT.SUPPORT_THREADS_FETCHED);
  },
});
