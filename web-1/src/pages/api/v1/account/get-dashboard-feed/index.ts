import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { getDashboardFeed_IO } from '@domain/account/operations/account-dashboard.operations';
import type { ACCOUNT_DTO_API_V1 } from '@kernel/models/account/account.dto';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  ACCOUNT_DTO_API_V1['ACCOUNT_GET_DASHBOARD_FEED']['REQUEST'],
  ACCOUNT_DTO_API_V1['ACCOUNT_GET_DASHBOARD_FEED']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.ACCOUNT.ACCOUNT_GET_DASHBOARD_FEED,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res) => {
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
