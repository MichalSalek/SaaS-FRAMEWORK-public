import { defineEndpoint } from '@app/http/define-endpoint';
import { ACCOUNT_CONTRACTS } from '@kernel/domain/account/account.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { getDashboardNote_IO } from '@domain/account/operations/account-settings.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineEndpoint(ACCOUNT_CONTRACTS.ACCOUNT_GET_DASHBOARD_NOTE, {
  handle: async ({ ctx, res }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await getDashboardNote_IO({
      stylist_account_id: currentUser.stylist_account?.account_id,
      client_account_id: currentUser.client_account?.client_account_id,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.ACCOUNT.DASHBOARD_NOTE_FETCHED
    );
  },
});
