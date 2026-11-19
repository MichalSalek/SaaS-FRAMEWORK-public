import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { getConversations_IO } from '@domain/messaging/operations/messaging-query.operations';
import { MESSAGING_CONTRACTS } from '@kernel/domain/messaging/messaging.contracts';
import { requireAuthenticatedContext } from '@domain/user/user.types';

// DECISION: only hidden === true selects the hidden list. Absent, false and any other
// value stay the default list, same as the old qBool(...) === true comparison.
// Test: web-1/src/test-utils/integration/messaging-contract.test.ts (false, a non-bool
// and an empty or repeated cursor; not the SQL filter itself).
export default defineEndpoint(MESSAGING_CONTRACTS.MESSAGING_GET_CONVERSATIONS, {
  handle: async ({ input, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    res.setHeader('Cache-Control', 'no-store');

    const cursor = input.cursor;
    const hidden = input.hidden === true;

    const result = await getConversations_IO({
      currentUser,
      ...(cursor !== undefined ? { cursor } : {}),
      hidden,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    ok(result.data, APP_EVENTS.INFO.MESSAGING.MESSAGING_CONVERSATIONS_FETCHED);
  },
});
