import { defineEndpoint } from '@app/http/define-endpoint';
import { USER_CONTRACTS } from '@kernel/domain/user/user.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { switchRole_IO } from '@domain/user/operations/user-onboarding.operations';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { requireAuthenticatedContext } from '@domain/user/user.types';

export default defineEndpoint(USER_CONTRACTS.USER_SWITCH_ROLE, {
  handle: async ({ input: body, ctx, meta: metadata, res }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await switchRole_IO({
      userId: currentUser.id,
      targetAccountType: body.account_type,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
    // Audit the RBAC-decisive transition (role_id + account_type). account_type is
    // a STYLIST/CLIENT enum, not PII — safe to log as the transition target.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.USER.USER_ROLE_SWITCHED,
        user: { id: currentUser.id },
        requestBody: { account_type: body.account_type },
        metadata,
      })
    );

    respondSuccess(res, result.data, APP_EVENTS.INFO.USER.USER_ROLE_SWITCHED);
  },
});
