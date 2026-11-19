import { defineEndpoint } from '@app/http/define-endpoint';
import { ACCOUNT_CONTRACTS } from '@kernel/domain/account/account.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { changePaidPlan_IO } from '@domain/account/operations/account-plan-change.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';

export default defineEndpoint(ACCOUNT_CONTRACTS.ACCOUNT_PLAN_CHANGE, {
  handle: async ({ input: body, ctx, meta: metadata, res }) => {
    // userId ZAWSZE z sesji, NIGDY z body.
    const { session } = requireAuthenticatedContext(ctx);
    const result = await changePaidPlan_IO({
      userId: session.userId,
      targetPlanId: body.targetPlanId,
      billingPeriod: body.billingPeriod,
      ...(body.quoteId !== undefined ? { quoteId: body.quoteId } : {}),
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    if (result.data.status === 'completed') {
      // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
      runAfterResponse(() =>
        recordAuditEvent_IO({
          eventName: APP_EVENTS.INFO.ACCOUNT.PRICING_PLAN_CHANGED,
          user: { id: session.userId },
          requestBody: {
            targetPlanId: body.targetPlanId,
            billingPeriod: body.billingPeriod,
            status: result.data.status,
          },
          metadata,
        })
      );
    }

    respondSuccess(res, result.data);
  },
});
