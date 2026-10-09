import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondSuccess } from '@app/http/http.responses.utils';
import { confirmDeleteSelf_IO } from '@domain/user/operations/user-mutations.operations';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { mapErrorToResponse } from '@app/http/error-mapper';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';
export default defineHandler<
  USER_DTO_API_V1['USER_DELETE_CONFIRM']['REQUEST'],
  USER_DTO_API_V1['USER_DELETE_CONFIRM']['RESPONSE']
>({
  eventName: APP_EVENTS.CONFIRMATIONS.USER_DELETE_CONFIRM,
  method: 'get',
  authCheck: false,
  // GET endpoint (account-deletion confirmation link) — promote query token to body.
  mapRequest: req => {
    req.body = {
      token: (req.query.token as string) || req.body?.token,
    };
  },
  validate: VALIDATION_POLICY.validators.deleteConfirm,
  handle: async (body, _ctx, metadata, res) => {
    const result = await confirmDeleteSelf_IO({ token: body.token });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // DECISION (nie usuwaj tego komentarza):
    // Endpoint nie wymaga uwierzytelnienia (AUTHENTICATION_CHECK_ENABLED=false,
    // token-based confirmation z emaila). Mimo to MUSIMY przekazać user.id
    // (zwracane z operation w result.data.userId) do recordAuditEvent_IO →
    // bez tego writeRawEventLog_IO odrzuca event z error-mode log
    // "missing meta.created_by_user_id" + brak audit row.
    // Audit only when THIS call deleted the account: a replayed link (already
    // deleted, token consumed, lost race) stays an idempotent success for the
    // client but must not add a second USER_DELETE_CONFIRMED row.
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
