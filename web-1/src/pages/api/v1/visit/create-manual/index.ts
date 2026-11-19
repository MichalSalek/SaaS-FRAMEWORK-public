import { getEffectivePricingPlan } from '@kernel/domain/pricing/effective-plan';
import { redactAuditPayload } from '@app/event-log/event-log-io.wrapper';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { defineEndpoint } from '@app/http/define-endpoint';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { createManualVisit_IO } from '@domain/visit/operations/visit-record.operations';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { VISIT_CONTRACTS } from '@kernel/domain/visit/visit.contracts';

export default defineEndpoint(VISIT_CONTRACTS.CREATE_MANUAL_VISIT, {
  handle: async ({ input, ctx, res, created, audit }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireStylistAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    const result = await createManualVisit_IO({
      stylist_account_id: accountCheck.data.account_id,
      client_user_id: input.client_user_id,
      stylist_pricing_plan: getEffectivePricingPlan(accountCheck.data),
      visit_date: input.visit_date,
      ...(input.service_note !== undefined && {
        service_note: input.service_note,
      }),
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    audit(APP_EVENTS.INFO.VISIT.VISIT_CREATED, {
      user: { id: currentUser.id },
      requestBody: redactAuditPayload(input, ['client_user_id', 'visit_date']),
      responseBody: { visit_id: result.data.id },
    });

    created({ visit: result.data }, APP_EVENTS.INFO.VISIT.VISIT_CREATED);
  },
});
