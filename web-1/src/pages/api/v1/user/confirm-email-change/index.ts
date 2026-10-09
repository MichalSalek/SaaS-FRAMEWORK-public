import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondSuccess } from '@app/http/http.responses.utils';
import { confirmEmailChange_IO } from '@domain/user/operations/user-email-change.operations';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { mapErrorToResponse } from '@app/http/error-mapper';
export default defineHandler<
  USER_DTO_API_V1['USER_EMAIL_CHANGE_CONFIRM']['REQUEST'],
  USER_DTO_API_V1['USER_EMAIL_CHANGE_CONFIRM']['RESPONSE']
>({
  eventName: APP_EVENTS.CONFIRMATIONS.USER_EMAIL_CHANGE_CONFIRM,
  method: 'get',
  authCheck: false,
  // GET endpoint (email-confirmation link) — promote query token to body for validation.
  mapRequest: req => {
    req.body = {
      token: (req.query.token as string) || req.body?.token,
    };
  },
  validate: VALIDATION_POLICY.validators.emailChangeConfirm,
  handle: async (body, _ctx, metadata, res) => {
    const result = await confirmEmailChange_IO({ token: body.token });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // DECISION (nie usuwaj tego komentarza):
    // Endpoint nie wymaga uwierzytelnienia (AUTHENTICATION_CHECK_ENABLED=false,
    // token-based confirmation). Operation zwraca userId w result.data abyśmy
    // mogli wypełnić meta.created_by_user_id w recordAuditEvent_IO. Bez tego
    // writeRawEventLog_IO loguje "missing meta.created_by_user_id" w trybie error.
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
