import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import {
  respondSuccess,
  respondValidationFailed,
} from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import type { CLIENT_DTO_API_V1 } from '@kernel/models/client/client.dto';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { getClientContactForStylist_IO } from '@domain/client/operations/client-profile.operations';
import { qStr } from '@app/http/query-params.utils';
import { getClientInfoFromReq } from '@app/http/extract-client-info';
export default defineHandler<
  CLIENT_DTO_API_V1['CLIENT_GET_CONTACT_FOR_STYLIST']['REQUEST'],
  CLIENT_DTO_API_V1['CLIENT_GET_CONTACT_FOR_STYLIST']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.CLIENT.CLIENT_GET_CONTACT_FOR_STYLIST,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res, req) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    res.setHeader('Cache-Control', 'no-store');

    const client_user_id = qStr(req.query, 'client_user_id');
    if (!client_user_id) {
      return respondValidationFailed(res, { client_user_id: 'Required' });
    }

    // Extract IP and user agent for audit logging (GDPR compliance)
    const { ip: _ip, userAgent: _ua } = getClientInfoFromReq(req.headers);
    const ip_address = _ip ?? undefined;
    const user_agent = _ua ?? undefined;

    const result = await getClientContactForStylist_IO({
      client_user_id,
      stylist_user_id: currentUser.id,
      ip_address: ip_address || undefined,
      user_agent: user_agent || undefined,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    const responsePayload: CLIENT_DTO_API_V1['CLIENT_GET_CONTACT_FOR_STYLIST']['RESPONSE'] =
      {
        contact_phone: result.data.contact_phone,
        contact_email: result.data.contact_email,
        client_name: result.data.client_name,
      };

    respondSuccess(
      res,
      responsePayload,
      APP_EVENTS.INFO.CLIENT.CLIENT_CONTACT_FETCHED
    );
  },
});
