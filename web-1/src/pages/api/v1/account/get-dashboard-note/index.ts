import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import type { ACCOUNT_DTO_API_V1 } from '@kernel/models/account/account.dto';
import { getDashboardNote_IO } from '@domain/account/operations/account-settings.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  ACCOUNT_DTO_API_V1['ACCOUNT_GET_DASHBOARD_NOTE']['REQUEST'],
  ACCOUNT_DTO_API_V1['ACCOUNT_GET_DASHBOARD_NOTE']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.ACCOUNT.ACCOUNT_GET_DASHBOARD_NOTE,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res) => {
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
