import { getEffectivePricingPlan } from '@kernel/domain/pricing/effective-plan';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { defineEndpoint } from '@app/http/define-endpoint';
import { respondValidationFailed } from '@app/http/http.responses.utils';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { getClientVisits_IO } from '@domain/visit/operations/visit-record.operations';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { VISIT_CONTRACTS } from '@kernel/domain/visit/visit.contracts';

export default defineEndpoint(VISIT_CONTRACTS.GET_CLIENT_VISITS, {
  handle: async ({ input, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireStylistAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    if (!input.client_user_id) {
      return respondValidationFailed(res, { client_user_id: 'Required' });
    }

    const result = await getClientVisits_IO({
      stylist_account_id: accountCheck.data.account_id,
      client_user_id: input.client_user_id,
      stylist_pricing_plan: getEffectivePricingPlan(accountCheck.data),
      ...(input.cursor && { cursor: input.cursor }),
      take: input.take,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    ok(result.data, APP_EVENTS.INFO.VISIT.CLIENT_VISITS_FETCHED);
  },
});
