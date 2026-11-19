import { defineEndpoint } from '@app/http/define-endpoint';
import { USER_CONTRACTS } from '@kernel/domain/user/user.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { respondSuccess } from '@app/http/http.responses.utils';
import { deleteSelfUser_IO } from '@domain/user/operations/user-mutations.operations';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineEndpoint(USER_CONTRACTS.USER_GDPR_ERASE, {
  handle: async ({ ctx, meta: metadata, res }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);

    // Impersonation gate runs centrally in request.middleware (5c).

    const erasedUserId = currentUser.id;

    await recordAuditEvent_IO({
      eventName: APP_EVENTS.INFO.USER.ACCOUNT_GDPR_ERASED,
      user: { id: erasedUserId },
      metadata,
    });

    const result = await deleteSelfUser_IO({ id: erasedUserId });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // DECISION: the front's "permanent delete" = terminal hard-delete with the account body written to
    // DeletedUser. The self-protecting marker (non-restorable at once) is set inside deleteUser_IO, see
    // web-1/src/domain/user/operations/user-crud.operations.ts, so this endpoint needs no separate
    // finalize step.
    const responsePayload: USER_DTO_API_V1['USER_GDPR_ERASE']['RESPONSE'] = {
      erased: true,
    };
    respondSuccess(
      res,
      responsePayload,
      APP_EVENTS.INFO.USER.ACCOUNT_GDPR_ERASED
    );
  },
});
