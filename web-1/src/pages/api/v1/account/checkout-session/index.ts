import { detectRequestCountry } from '@app/localization/country.detector';
import { defineEndpoint } from '@app/http/define-endpoint';
import { ACCOUNT_CONTRACTS } from '@kernel/domain/account/account.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { createCheckoutSession_IO } from '@domain/account/operations/account-stripe.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';

export default defineEndpoint(ACCOUNT_CONTRACTS.ACCOUNT_CHECKOUT_SESSION, {
  handle: async ({ input: body, ctx, meta: metadata, req, res }) => {
    // userId ZAWSZE z sesji, NIGDY z body.
    const { session } = requireAuthenticatedContext(ctx);
    const observedCountry = detectRequestCountry(req.headers);
    const result = await createCheckoutSession_IO({
      userId: session.userId,
      planId: body.planId,
      billingPeriod: body.billingPeriod,
      ...(observedCountry && { observedCountry }),
      ...(body.currency !== undefined && { currency: body.currency }),
      ...(body.billingCountry !== undefined && {
        billingCountry: body.billingCountry,
      }),
      ...(body.source !== undefined && { source: body.source }),
      ...(body.promo !== undefined && { promo: body.promo }),
      ...(body.expectedTrialDays !== undefined && {
        expectedTrialDays: body.expectedTrialDays,
      }),
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
