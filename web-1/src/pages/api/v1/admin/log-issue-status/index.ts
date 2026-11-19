import { defineEndpoint } from '@app/http/define-endpoint';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import {
  recordAuditEvent_IO,
  redactAuditPayload,
} from '@app/event-log/event-log-io.wrapper';
import { adminSetLogIssueStatus_IO } from '@domain/admin/operations/admin-log-groups.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';

export default defineEndpoint(ADMIN_CONTRACTS.ADMIN_SET_LOG_ISSUE_STATUS, {
  handle: async ({ input: body, ctx, meta: metadata, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);

    const result = await adminSetLogIssueStatus_IO({ body, currentUser });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // An admin note can carry any text. The audit stores only the fingerprint
    // and the status, which is what describes the decision.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.ADMIN.LOG_ISSUE_STATUS_SET,
        user: { id: currentUser.id },
        requestBody: redactAuditPayload(body, ['fingerprint', 'status']),
        responseBody: result.data,
        metadata,
      })
    );

    ok(result.data, APP_EVENTS.INFO.ADMIN.LOG_ISSUE_STATUS_SET);
  },
});
