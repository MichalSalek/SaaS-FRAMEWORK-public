import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import {
  respondSuccess,
  respondValidationFailed,
} from '@app/http/http.responses.utils';
import type { PAIRING_DTO_API_V1 } from '@kernel/models/pairing/pairing.dto';
import { getAccessStatus_IO } from '@domain/pairing/operations/pairing-access.operations';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { qStr } from '@app/http/query-params.utils';
export default defineHandler<
  PAIRING_DTO_API_V1['PAIRING_GET_ACCESS_STATUS']['REQUEST'],
  PAIRING_DTO_API_V1['PAIRING_GET_ACCESS_STATUS']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.PAIRING.PAIRING_GET_ACCESS_STATUS,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, { currentUser }, _metadata, res, req) => {
    res.setHeader('Cache-Control', 'no-store');

    const stylist_account_id = qStr(req.query, 'stylist_account_id');
    if (!stylist_account_id) {
      return respondValidationFailed(res, { stylist_account_id: 'Required' });
    }

    const result = await getAccessStatus_IO({
      ...(currentUser?.id !== undefined && {
        client_user_id: currentUser.id,
      }),
      stylist_account_id,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    const responsePayload: PAIRING_DTO_API_V1['PAIRING_GET_ACCESS_STATUS']['RESPONSE'] =
      {
        access: result.data.access,
        ...('paired_at' in result.data &&
          result.data.paired_at != null && {
            paired_at: result.data.paired_at.toISOString(),
          }),
        ...('pair_id' in result.data && { pair_id: result.data.pair_id }),
      };

    respondSuccess(
      res,
      responsePayload,
      APP_EVENTS.INFO.PAIRING.PAIRING_ACCESS_STATUS_FETCHED
    );
  },
});
