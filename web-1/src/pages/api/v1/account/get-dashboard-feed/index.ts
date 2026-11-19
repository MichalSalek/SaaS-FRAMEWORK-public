import { defineEndpoint } from '@app/http/define-endpoint';
import { ACCOUNT_CONTRACTS } from '@kernel/domain/account/account.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { getDashboardFeed_IO } from '@domain/account/operations/account-dashboard.operations';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineEndpoint(ACCOUNT_CONTRACTS.ACCOUNT_GET_DASHBOARD_FEED, {
  handle: async ({ ctx, res }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireStylistAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    const result = await getDashboardFeed_IO({
      stylist_account_id: accountCheck.data.account_id,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.ACCOUNT.DASHBOARD_FEED_FETCHED
    );
  },
});
