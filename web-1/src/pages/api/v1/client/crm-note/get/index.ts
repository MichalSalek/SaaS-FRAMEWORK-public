import { mapErrorToResponse } from '@app/http/error-mapper';
import { defineHandler } from '@app/http/define-handler';
import { qStr } from '@app/http/query-params.utils';
import {
  respondSuccess,
  respondValidationFailed,
} from '@app/http/http.responses.utils';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { getClientCrmNote_IO } from '@domain/client/operations/client-crm-note.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { VISIT_DTO_API_V1 } from '@kernel/models/visit/visit.dto';

export default defineHandler<
  VISIT_DTO_API_V1['CLIENT_GET_CRM_NOTE']['REQUEST'],
  VISIT_DTO_API_V1['CLIENT_GET_CRM_NOTE']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.CLIENT.CLIENT_GET_CRM_NOTE,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res, req) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireStylistAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    const client_user_id = qStr(req.query, 'client_user_id');
    if (!client_user_id) {
      return respondValidationFailed(res, { client_user_id: 'Required' });
    }

    const result = await getClientCrmNote_IO({
      stylist_account_id: accountCheck.data.account_id,
      client_user_id,
      stylist_pricing_plan: accountCheck.data.pricing_plan,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.CLIENT.CLIENT_CRM_NOTE_FETCHED
    );
  },
});
