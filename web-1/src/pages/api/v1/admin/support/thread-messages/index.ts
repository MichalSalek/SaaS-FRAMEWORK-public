import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondValidationFailed } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminGetThreadMessages_IO } from '@domain/support/operations/support-admin.operations';
import { SUPPORT_CONTRACTS } from '@kernel/domain/support/support.contracts';
import { requireAuthenticatedContext } from '@domain/user/user.types';

// DECISION: see support/thread-messages (missing thread id stays `{ thread_id: 'Required' }`).
export default defineEndpoint(
  SUPPORT_CONTRACTS.SUPPORT_ADMIN_GET_THREAD_MESSAGES,
  {
    handle: async ({ input, ctx, res, ok }) => {
      const { currentUser } = requireAuthenticatedContext(ctx);
      const threadId = input.thread_id;
      if (threadId === undefined) {
        respondValidationFailed(res, { thread_id: 'Required' });
        return;
      }

      const result = await adminGetThreadMessages_IO(threadId, currentUser);

      if (!result.success) {
        return mapErrorToResponse(res, result.error);
      }

      ok(result.data, APP_EVENTS.INFO.SUPPORT.SUPPORT_ADMIN_MESSAGES_FETCHED);
    },
  }
);
