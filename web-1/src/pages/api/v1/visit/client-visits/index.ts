import { mapErrorToResponse } from '@app/http/error-mapper';
import { defineHandler } from '@app/http/define-handler';
import { qInt, qStr } from '@app/http/query-params.utils';
import {
  respondSuccess,
  respondValidationFailed,
} from '@app/http/http.responses.utils';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { getClientVisits_IO } from '@domain/visit/operations/visit-record.operations';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { VISIT_DTO_API_V1 } from '@kernel/models/visit/visit.dto';

export default defineHandler<
  VISIT_DTO_API_V1['GET_CLIENT_VISITS']['REQUEST'],
  VISIT_DTO_API_V1['GET_CLIENT_VISITS']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.VISIT.GET_CLIENT_VISITS,
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

    const cursor = qStr(req.query, 'cursor') ?? undefined;
    const take = qInt(req.query, 'take') ?? undefined;

    const result = await getClientVisits_IO({
      stylist_account_id: accountCheck.data.account_id,
      client_user_id,
      stylist_pricing_plan: accountCheck.data.pricing_plan,
      ...(cursor && { cursor }),
      ...(take !== undefined && { take }),
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.VISIT.CLIENT_VISITS_FETCHED
    );
  },
});
