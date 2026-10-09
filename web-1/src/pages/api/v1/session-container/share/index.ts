import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import type { SESSION_CONTAINER_DTO_API_V1 } from '@kernel/models/session-container/session-container.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { requireClientAccount } from '@domain/_shared/guards/account-guards';
import { shareSessionContainer_IO } from '@domain/session-container/operations/session-container.operations';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { emitInfoEvent } from '@app/events/event-bus';
export default defineHandler<
  SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_SHARE']['REQUEST'],
  SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_SHARE']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.SESSION_CONTAINER.SESSION_CONTAINER_SHARE,
  method: 'post',
  validate: VALIDATION_POLICY.validators.sessionContainerShare,
  handle: async (body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const clientAccountResult = requireClientAccount(currentUser);
    if (!clientAccountResult.success) {
      return mapErrorToResponse(res, clientAccountResult.error);
    }

    const result = await shareSessionContainer_IO({
      client_user_id: currentUser.id,
      client_account_id: clientAccountResult.data.client_account_id,
      session_id: body.session_id,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_SHARED,
        user: currentUser,
        requestBody: body,
        metadata,
      })
    );

    // Mail „klientka udostępniła Ci sesję" (2026-07-12): emit SYNCHRONICZNY
    // (parytet z PAIR_REQUEST_SENT) — emitInfoEvent sam odracza handler przez
    // runAfterResponse, więc bez podwójnego opakowania. Lookup e-maila stylistki
    // (PII) żyje w session-shared.listener; payload niesie tylko id. Best-effort:
    // brak konta / e-maila = cichy no-op po stronie listenera (share już się udał).
    if (result.data.stylistAccountId) {
      emitInfoEvent(
        APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_SHARED,
        {
          stylistAccountId: result.data.stylistAccountId,
          clientName: currentUser.name || null,
          sessionId: body.session_id,
        }
      );
    }

    respondSuccess(
      res,
      { session: result.data },
      APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_SHARED
    );
  },
});
