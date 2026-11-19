import { defineEndpoint } from '@app/http/define-endpoint';
import { USER_CONTRACTS } from '@kernel/domain/user/user.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondSuccess } from '@app/http/http.responses.utils';
import { disableSelfUser_IO } from '@domain/user/operations/user-state.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { mapErrorToResponse } from '@app/http/error-mapper';
export default defineEndpoint(USER_CONTRACTS.USER_DISABLE_SELF, {
  handle: async ({ ctx, meta: metadata, res }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    // Impersonation gate runs centrally in request.middleware (5c).

    const result = await disableSelfUser_IO({
      id: currentUser.id,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // DECISION: disableSelfUser_IO is a compare-and-set and returns success(null) for an idempotent no-op
    // (account ALREADY disabled, or a lost race of parallel self-disables). The USER_DISABLED_SELF audit is
    // emitted ONLY when data !== null (the CAS winner); otherwise N parallel calls produced N duplicate
    // events (8/8 under READ COMMITTED). Parity with confirmDeleteSelf_IO, which short-circuits on
    // softDeleteResult.data === null. The response shape (200 + USER_DISABLED_SELF) is the same on both
    // paths: the logical outcome is the same, only the audit side effect differs.
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
