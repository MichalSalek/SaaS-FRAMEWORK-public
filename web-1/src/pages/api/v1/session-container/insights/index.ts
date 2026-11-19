import { defineEndpoint } from '@app/http/define-endpoint';
import { respondOnError } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { getEffectivePricingPlan } from '@kernel/domain/pricing/effective-plan';
import { SESSION_CONTAINER_CONTRACTS } from '@kernel/domain/session-container/session-container.contracts';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { getSessionInsights_IO } from '@domain/session-container/operations/session-insights.operations';

export default defineEndpoint(
  SESSION_CONTAINER_CONTRACTS.SESSION_CONTAINER_INSIGHTS,
  {
    handle: async ({ ctx, res, ok }) => {
      const { currentUser } = requireAuthenticatedContext(ctx);
      const accountCheck = requireStylistAccount(currentUser);
      if (!accountCheck.success) {
        return mapErrorToResponse(res, accountCheck.error);
      }
      const result = await getSessionInsights_IO({
        stylist_account_id: accountCheck.data.account_id,
        pricing_plan: getEffectivePricingPlan(accountCheck.data),
      });
      if (respondOnError(res, result)) {
        return;
      }
      ok(
        result.data,
        APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_INSIGHTS_FETCHED
      );
    },
  }
);
