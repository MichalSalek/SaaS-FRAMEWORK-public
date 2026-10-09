import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import type { SESSION_CONTAINER_DTO_API_V1 } from '@kernel/models/session-container/session-container.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { setSessionContainerNote_IO } from '@domain/session-container/operations/session-container.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import {
  recordAuditEvent_IO,
  redactAuditPayload,
} from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
export default defineHandler<
  SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_SET_NOTE']['REQUEST'],
  SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_SET_NOTE']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.SESSION_CONTAINER.SESSION_CONTAINER_SET_NOTE,
  method: 'post',
  validate: VALIDATION_POLICY.validators.sessionContainerSetNote,
  handle: async (body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await setSessionContainerNote_IO({
      session_id: body.session_id,
      note: body.note,
      side: body.side,
      client_account_id: currentUser.client_account?.client_account_id,
      stylist_account_id: currentUser.stylist_account?.account_id,
      user_id: currentUser.id,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
    // PII redaction: `note` is free-text PII. Log session_id + side enum only.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName:
          APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_NOTE_UPDATED,
        user: { id: currentUser.id },
        requestBody: redactAuditPayload(body, ['session_id', 'side']),
        metadata,
      })
    );

    respondSuccess(
      res,
      { session: result.data },
      APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_NOTE_UPDATED
    );
  },
});
