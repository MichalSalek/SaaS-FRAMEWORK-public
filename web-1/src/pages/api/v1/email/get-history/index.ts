import { requireAdminPermission } from '@domain/admin/admin.guards';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { defineEndpoint } from '@app/http/define-endpoint';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { getEmailHistory_IO } from '@domain/email/operations/email-query.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { EMAIL_CONTRACTS } from '@kernel/domain/email/email.contracts';

export default defineEndpoint(EMAIL_CONTRACTS.EMAIL_GET_HISTORY, {
  handle: async ({ input, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    // DECISION: retain the old admin query during independent frontend/backend rollout.
    // Normal clients use their session id; only an admin can select a legacy target.
    // Test: web-1/src/test-utils/integration/email-history-access.test.ts (real grants, mocked DB/auth).
    let targetUserId = currentUser.id;
    if (input.userId !== undefined) {
      const permitted = requireAdminPermission(currentUser);
      if (!permitted.success) {
        return mapErrorToResponse(res, permitted.error);
      }
      targetUserId = input.userId;
    }
    const result = await getEmailHistory_IO(targetUserId, {
      cursor: input.cursor,
      take: input.take,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }
    ok(result.data, APP_EVENTS.INFO.EMAIL.EMAIL_HISTORY_FETCHED);
  },
});
