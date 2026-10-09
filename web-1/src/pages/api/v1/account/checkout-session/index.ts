import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { createCheckoutSession_IO } from '@domain/account/operations/account-stripe.operations';
import type { ACCOUNT_DTO_API_V1 } from '@kernel/models/account/account.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { requireAuthenticatedContext } from '@domain/user/user.types';

export default defineHandler<
  ACCOUNT_DTO_API_V1['ACCOUNT_CHECKOUT_SESSION']['REQUEST'],
  ACCOUNT_DTO_API_V1['ACCOUNT_CHECKOUT_SESSION']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.ACCOUNT.ACCOUNT_CHECKOUT_SESSION,
  method: 'post',
  validate: VALIDATION_POLICY.validators.checkoutSession,
  handle: async (body, ctx, metadata, res) => {
    // userId ZAWSZE z sesji, NIGDY z body.
    const { session } = requireAuthenticatedContext(ctx);
    const result = await createCheckoutSession_IO({
      userId: session.userId,
      planId: body.planId,
      billingPeriod: body.billingPeriod,
      ...(body.source !== undefined && { source: body.source }),
      ...(body.promo !== undefined && { promo: body.promo }),
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
    const auditEventName =
      result.data.mode === 'free_selected'
        ? APP_EVENTS.INFO.ACCOUNT.CHECKOUT_FREE_SELECTED
        : APP_EVENTS.INFO.ACCOUNT.CHECKOUT_SESSION_CREATED;
    const auditCheckoutSessionId =
      result.data.mode === 'free_selected'
        ? undefined
        : result.data.checkoutSessionId;
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: auditEventName,
        user: { id: session.userId },
        requestBody: {
          mode: result.data.mode,
          planId: body.planId,
          billingPeriod: body.billingPeriod,
          ...(auditCheckoutSessionId !== undefined && {
            checkoutSessionId: auditCheckoutSessionId,
          }),
        },
        metadata,
      })
    );

    respondSuccess(res, result.data);
  },
});
