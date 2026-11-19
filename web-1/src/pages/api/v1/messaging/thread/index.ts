import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { getThread_IO } from '@domain/messaging/operations/messaging-query.operations';
import { MESSAGING_CONTRACTS } from '@kernel/domain/messaging/messaging.contracts';
import { requireAuthenticatedContext } from '@domain/user/user.types';

// DECISION: a missing, empty or repeated pair_id stays '' and still calls getThread_IO.
// The handler never answered 400 for that query; the operation returns pair-not-found.
// Test: web-1/src/test-utils/integration/messaging-contract.test.ts (empty and repeated
// pair_id are not a 400; a foreign id is the operation's 404, not covered here).
export default defineEndpoint(MESSAGING_CONTRACTS.MESSAGING_GET_THREAD, {
  handle: async ({ input, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    res.setHeader('Cache-Control', 'no-store');

    const pairId = input.pair_id ?? '';
    const cursor = input.cursor;

    const result = await getThread_IO({
      currentUser,
      pairId,
      ...(cursor !== undefined ? { cursor } : {}),
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    ok(result.data, APP_EVENTS.INFO.MESSAGING.MESSAGING_THREAD_FETCHED);
  },
});
