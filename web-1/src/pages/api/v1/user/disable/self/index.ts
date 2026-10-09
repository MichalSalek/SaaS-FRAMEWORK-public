import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondSuccess } from '@app/http/http.responses.utils';
import { disableSelfUser_IO } from '@domain/user/operations/user-state.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { mapErrorToResponse } from '@app/http/error-mapper';
export default defineHandler<
  USER_DTO_API_V1['USER_DISABLE_SELF']['REQUEST'],
  USER_DTO_API_V1['USER_DISABLE_SELF']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.USER.USER_DISABLE_SELF,
  method: 'post',
  validate: VALIDATION_POLICY.validators.deleteOrDisableSelfUser,
  handle: async (_, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    // Impersonation gate runs centrally in request.middleware (5c).

    const result = await disableSelfUser_IO({
      id: currentUser.id,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // DECISION (nie usuwaj tego komentarza):
    // user-disable-self-1 (wf3): disableSelfUser_IO to compare-and-set i zwraca
    // success(null) na idempotentny no-op (konto JUZ wylaczone albo przegrany wyscig
    // rownoleglego self-disable). Audit USER_DISABLED_SELF emitujemy WYLACZNIE gdy
    // data !== null (winner CAS) — inaczej N rownoleglych wywolan produkowalo N
    // duplikatow eventu (8/8 pod READ COMMITTED). Parytet z confirmDeleteSelf_IO,
    // ktore short-circuituje na softDeleteResult.data === null. Response shape (200 +
    // USER_DISABLED_SELF) niezmieniony dla obu sciezek: wynik logiczny ("konto
    // wylaczone / juz wylaczone") jest ten sam, rozni sie tylko side-effect audytu.
    if (result.data !== null) {
      // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
      runAfterResponse(() =>
        recordAuditEvent_IO({
          eventName: APP_EVENTS.INFO.USER.USER_DISABLED_SELF,
          user: { id: currentUser.id },
          metadata,
        })
      );
    }

    respondSuccess(res, undefined, APP_EVENTS.INFO.USER.USER_DISABLED_SELF);
  },
});
