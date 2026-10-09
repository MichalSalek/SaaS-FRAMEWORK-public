import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import type { SESSION_CONTAINER_DTO_API_V1 } from '@kernel/models/session-container/session-container.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { closeSessionContainer_IO } from '@domain/session-container/operations/session-container.operations';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_CLOSE']['REQUEST'],
  SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_CLOSE']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.SESSION_CONTAINER.SESSION_CONTAINER_CLOSE,
  method: 'post',
  validate: VALIDATION_POLICY.validators.sessionContainerClose,
  handle: async (body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    // Close can be done by either client or stylist — pass both account IDs
    const result = await closeSessionContainer_IO({
      client_account_id: currentUser.client_account?.client_account_id,
      stylist_account_id: currentUser.stylist_account?.account_id,
      session_id: body.session_id,
      user_id: currentUser.id,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_CLOSED,
        user: currentUser,
        requestBody: body,
        metadata,
      })
    );

    respondSuccess(
      res,
      { session: result.data },
      APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_CLOSED
    );
  },
});
