import { defineEndpoint } from '@app/http/define-endpoint';
import { USER_CONTRACTS } from '@kernel/domain/user/user.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondSuccess } from '@app/http/http.responses.utils';
import { changeUserEmail_IO } from '@domain/user/operations/user-email-change.operations';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineEndpoint(USER_CONTRACTS.USER_REQUEST_EMAIL_CHANGE, {
  handle: async ({ input: body, ctx, meta: metadata, res }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    // Impersonation gate runs centrally in request.middleware (5c).

    const result = await changeUserEmail_IO({
      id: currentUser.id,
      new_email: body.email,
      current_email: currentUser.email,
      user_name: currentUser.name,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
    // PII redaction: new_email is PII. Log only boolean flag (presence is the
    // signal — the email change event itself is the meaningful audit trail).
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.USER.USER_EMAIL_CHANGE_REQUESTED,
        user: { id: currentUser.id },
        requestBody: { has_pending_change: true },
        metadata,
      })
    );

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.USER.USER_EMAIL_CHANGE_REQUESTED
    );
  },
});
