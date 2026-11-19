import { defineEndpoint } from '@app/http/define-endpoint';
import { USER_CONTRACTS } from '@kernel/domain/user/user.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { onboardAsClient_IO } from '@domain/user/operations/user-onboarding.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineEndpoint(USER_CONTRACTS.USER_ONBOARD_AS_CLIENT, {
  handle: async ({ input: body, ctx, meta: metadata, res }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await onboardAsClient_IO({
      userId: currentUser.id,
      termsAccepted: body.terms_accepted === true,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.USER.CLIENT_ACCOUNT_CREATED,
        user: currentUser,
        requestBody: {},
        metadata,
      })
    );

    // DECISION: 200 OK, not 201. onboardAsClient is an idempotent find-or-create (returns the EXISTING
    // client_account when already onboarded; the role is reconciled on every path), so a re-call returns the
    // SAME resource and 201 would falsely signal a new account. Same as claim-session / onboard-stylist.
    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.USER.CLIENT_ACCOUNT_CREATED
    );
  },
});
