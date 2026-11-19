import { defineEndpoint } from '@app/http/define-endpoint';
import { USER_CONTRACTS } from '@kernel/domain/user/user.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondSuccess } from '@app/http/http.responses.utils';
import { confirmEmailChange_IO } from '@domain/user/operations/user-email-change.operations';
import { mapErrorToResponse } from '@app/http/error-mapper';
export default defineEndpoint(USER_CONTRACTS.USER_EMAIL_CHANGE_CONFIRM, {
  beforeParse: req => {
    const fromQuery = req.query.token;
    const queryToken = typeof fromQuery === 'string' ? fromQuery : '';
    const body = req.body;
    const bodyToken =
      body !== null && typeof body === 'object' && 'token' in body
        ? body.token
        : undefined;
    req.body = { token: queryToken || bodyToken };
  },
  handle: async ({ input: body, meta: metadata, res }) => {
    const result = await confirmEmailChange_IO({ token: body.token });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // DECISION: the endpoint is unauthenticated (AUTHENTICATION_CHECK_ENABLED=false, token-based
    // confirmation); the operation returns userId in result.data so meta.created_by_user_id can be filled
    // in recordAuditEvent_IO (see user-email-change.operations.ts).
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.USER.USER_EMAIL_CHANGE_CONFIRMED,
        user: { id: result.data.userId },
        responseBody: { confirmed: true },
        metadata,
      })
    );

    respondSuccess(
      res,
      { confirmed: result.data.confirmed },
      APP_EVENTS.INFO.USER.USER_EMAIL_CHANGE_CONFIRMED
    );
  },
});
