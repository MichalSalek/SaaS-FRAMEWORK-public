import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondCreated } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import type { SESSION_CONTAINER_DTO_API_V1 } from '@kernel/models/session-container/session-container.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { requireClientAccount } from '@domain/_shared/guards/account-guards';
import { createSessionContainer_IO } from '@domain/session-container/operations/session-container.operations';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_CREATE']['REQUEST'],
  SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_CREATE']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.SESSION_CONTAINER.SESSION_CONTAINER_CREATE,
  method: 'post',
  validate: VALIDATION_POLICY.validators.sessionContainerCreate,
  handle: async (body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    // Account guard — owning side is always the client.
    const clientAccountResult = requireClientAccount(currentUser);
    if (!clientAccountResult.success) {
      return mapErrorToResponse(res, clientAccountResult.error);
    }

    const result = await createSessionContainer_IO({
      client_user_id: currentUser.id,
      client_account_id: clientAccountResult.data.client_account_id,
      stylist_account_id: body?.stylist_account_id ?? undefined,
      name: body?.name ?? undefined,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_CREATED,
        user: currentUser,
        requestBody: body,
        metadata,
      })
    );

    const responsePayload: SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_CREATE']['RESPONSE'] =
      { session: result.data };
    respondCreated(
      res,
      responsePayload,
      APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_CREATED
    );
  },
});
