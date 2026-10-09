import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { createBillingPortalSession_IO } from '@domain/account/operations/account-stripe.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<undefined>({
  eventName: APP_EVENTS.COMMANDS.ACCOUNT.ACCOUNT_STRIPE_PORTAL,
  method: 'post',
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, metadata, res) => {
    const { session } = requireAuthenticatedContext(ctx);
    const result = await createBillingPortalSession_IO({
      userId: session.userId,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.ACCOUNT.STRIPE_PORTAL_SESSION_CREATED,
        user: { id: session.userId },
        requestBody: { portalSessionId: result.data.portalSessionId },
        metadata,
      })
    );

    respondSuccess(res, {
      url: result.data.portalUrl,
    });
  },
});
