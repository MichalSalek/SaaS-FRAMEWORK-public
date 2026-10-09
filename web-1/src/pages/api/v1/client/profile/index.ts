import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import type { CLIENT_DTO_API_V1 } from '@kernel/models/client/client.dto';
import { getClientProfile_IO } from '@domain/client/operations/client-profile.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  CLIENT_DTO_API_V1['CLIENT_GET_PROFILE']['REQUEST'],
  CLIENT_DTO_API_V1['CLIENT_GET_PROFILE']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.CLIENT.CLIENT_GET_PROFILE,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await getClientProfile_IO({
      user_id: currentUser.id,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    const responsePayload: CLIENT_DTO_API_V1['CLIENT_GET_PROFILE']['RESPONSE'] =
      {
        contact_phone: result.data.contact_phone,
        contact_email: result.data.contact_email,
        created_at: result.data.created_at,
      };

    respondSuccess(
      res,
      responsePayload,
      APP_EVENTS.INFO.CLIENT.CLIENT_PROFILE_FETCHED
    );
  },
});
