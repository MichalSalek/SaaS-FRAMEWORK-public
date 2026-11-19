import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { getClientProfile_IO } from '@domain/client/operations/client-profile.operations';
import { CLIENT_CONTRACTS } from '@kernel/domain/client/client.contracts';
import { requireAuthenticatedContext } from '@domain/user/user.types';

export default defineEndpoint(CLIENT_CONTRACTS.CLIENT_GET_PROFILE, {
  handle: async ({ ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await getClientProfile_IO({
      user_id: currentUser.id,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    ok(result.data, APP_EVENTS.INFO.CLIENT.CLIENT_PROFILE_FETCHED);
  },
});
