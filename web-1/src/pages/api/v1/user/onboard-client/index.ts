import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { onboardAsClient_IO } from '@domain/user/operations/user-onboarding.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  USER_DTO_API_V1['USER_ONBOARD_AS_CLIENT']['REQUEST'],
  USER_DTO_API_V1['USER_ONBOARD_AS_CLIENT']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.USER.USER_ONBOARD_AS_CLIENT,
  method: 'post',
  validate: VALIDATION_POLICY.validators.userOnboardAsClient,
  handle: async (body, ctx, metadata, res) => {
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

    // DECISION (nie usuwaj tego komentarza):
    // 200 OK (NOT 201) — BDX W2.5b. onboardAsClient is idempotent find-or-create
    // (returns the EXISTING client_account when already onboarded; the role is
    // reconciled on every path). Re-calling returns the SAME resource, so 200 is
    // correct — 201 would falsely signal "a new account was created" on the
    // already-onboarded re-call. Mirror claim-session/onboard-stylist.
    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.USER.CLIENT_ACCOUNT_CREATED
    );
  },
});
