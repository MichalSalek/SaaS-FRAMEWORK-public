import { defineEndpoint } from '@app/http/define-endpoint';
import { USER_CONTRACTS } from '@kernel/domain/user/user.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';
import { changeUserName_IO } from '@domain/user/operations/user-query.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineEndpoint(USER_CONTRACTS.USER_CHANGE_NAME, {
  handle: async ({ input: body, ctx, meta: metadata, res }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await changeUserName_IO({
      userId: currentUser.id,
      name: body.name,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    const responsePayload: USER_DTO_API_V1['USER_CHANGE_NAME']['RESPONSE'] =
      result.data;
    // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
    // PII redaction: display_name (request) AND user_id+name (response) are PII.
    // Audit signal = the event itself + created_by_user_id meta column.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.USER.USER_NAME_CHANGED,
        user: { id: currentUser.id },
        requestBody: { name_changed: true },
        metadata,
      })
    );

    respondSuccess(
      res,
      responsePayload,
      APP_EVENTS.INFO.USER.USER_NAME_CHANGED
    );
  },
});
