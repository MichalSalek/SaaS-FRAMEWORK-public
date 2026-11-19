import { defineEndpoint } from '@app/http/define-endpoint';
import { USER_CONTRACTS } from '@kernel/domain/user/user.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondSuccess } from '@app/http/http.responses.utils';
import { confirmDeleteSelf_IO } from '@domain/user/operations/user-mutations.operations';
import { mapErrorToResponse } from '@app/http/error-mapper';
export default defineEndpoint(USER_CONTRACTS.USER_DELETE_CONFIRM, {
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
    const result = await confirmDeleteSelf_IO({ token: body.token });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // DECISION: the endpoint is unauthenticated (AUTHENTICATION_CHECK_ENABLED=false, token-based
    // confirmation from the e-mail), yet user.id (result.data.userId from the operation) MUST reach
    // recordAuditEvent_IO, else writeRawEventLog_IO rejects the event ("missing meta.created_by_user_id")
    // and no audit row is written. Audit only when THIS call deleted the account: a replayed link (already
    // deleted, token consumed, lost race) stays an idempotent success for the client but must not add a
    // second USER_DELETE_CONFIRMED row.
    if (result.data.applied) {
      runAfterResponse(() =>
        recordAuditEvent_IO({
          eventName: APP_EVENTS.INFO.USER.USER_DELETE_CONFIRMED,
          user: { id: result.data.userId },
          responseBody: { confirmed: true },
          metadata,
        })
      );
    }

    respondSuccess(
      res,
      { confirmed: result.data.confirmed },
      APP_EVENTS.INFO.USER.USER_DELETE_CONFIRMED
    );
  },
});
