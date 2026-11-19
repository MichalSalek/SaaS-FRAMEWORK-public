import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminChangeThreadStatus_IO } from '@domain/support/operations/support-admin.operations';
import { SUPPORT_CONTRACTS } from '@kernel/domain/support/support.contracts';
import { requireAuthenticatedContext } from '@domain/user/user.types';

export default defineEndpoint(SUPPORT_CONTRACTS.SUPPORT_CHANGE_STATUS, {
  handle: async ({ input, ctx, res, ok, audit }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await adminChangeThreadStatus_IO({
      threadId: input.thread_id,
      status: input.status,
      currentUser,
      // null and a missing token are an unconditional change (normalized in the operation).
      expectedUpdatedAt: input.expected_updated_at,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // A no-op transition writes nothing and does not audit. The response stays 200.
    if (!result.data.noop) {
      audit(APP_EVENTS.INFO.SUPPORT.SUPPORT_STATUS_CHANGED, {
        user: { id: currentUser.id },
        requestBody: { thread_id: input.thread_id, status: input.status },
      });
    }

    ok(
      { thread_id: result.data.thread_id, status: result.data.status },
      APP_EVENTS.INFO.SUPPORT.SUPPORT_STATUS_CHANGED
    );
  },
});
