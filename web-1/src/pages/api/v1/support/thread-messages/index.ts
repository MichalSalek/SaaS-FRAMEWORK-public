import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondValidationFailed } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { getSupportThreadMessages_IO } from '@domain/support/operations/support-thread-queries.operations';
import { SUPPORT_CONTRACTS } from '@kernel/domain/support/support.contracts';
import { requireAuthenticatedContext } from '@domain/user/user.types';

// DECISION: a missing thread id stays `{ thread_id: 'Required' }`, the handler's old answer.
// The kernel body schema for this shape was never on the request path; wiring it would swap that
// literal for an i18n token. Test: support-contract.test.ts (missing id is 400 and not the i18n key).
export default defineEndpoint(SUPPORT_CONTRACTS.SUPPORT_GET_THREAD_MESSAGES, {
  handle: async ({ input, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const threadId = input.thread_id;
    if (threadId === undefined) {
      respondValidationFailed(res, { thread_id: 'Required' });
      return;
    }

    const result = await getSupportThreadMessages_IO(currentUser.id, threadId);

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    ok(result.data, APP_EVENTS.INFO.SUPPORT.SUPPORT_MESSAGES_FETCHED);
  },
});
