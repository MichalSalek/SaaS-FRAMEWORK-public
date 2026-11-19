import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondValidationFailed } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { getClientContactForStylist_IO } from '@domain/client/operations/client-profile.operations';
import { getClientInfoFromReq } from '@app/http/extract-client-info';
import { CLIENT_CONTRACTS } from '@kernel/domain/client/client.contracts';
import { requireAuthenticatedContext } from '@domain/user/user.types';

// Missing, empty or repeated client_user_id: `{ client_user_id: 'Required' }` (CLIENT_CONTRACTS).
export default defineEndpoint(CLIENT_CONTRACTS.CLIENT_GET_CONTACT_FOR_STYLIST, {
  handle: async ({ input, ctx, req, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    res.setHeader('Cache-Control', 'no-store');

    const client_user_id = input.client_user_id;
    if (client_user_id === undefined) {
      respondValidationFailed(res, { client_user_id: 'Required' });
      return;
    }

    const { ip, userAgent } = getClientInfoFromReq(req.headers);
    const result = await getClientContactForStylist_IO({
      client_user_id,
      stylist_user_id: currentUser.id,
      ip_address: ip || undefined,
      user_agent: userAgent || undefined,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    ok(
      {
        contact_phone: result.data.contact_phone,
        contact_email: result.data.contact_email,
        client_name: result.data.client_name,
      },
      APP_EVENTS.INFO.CLIENT.CLIENT_CONTACT_FETCHED
    );
  },
});
