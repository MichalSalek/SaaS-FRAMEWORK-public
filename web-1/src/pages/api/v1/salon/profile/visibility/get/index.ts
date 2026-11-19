import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { getSalonProfileVisibility_IO } from '@domain/salon-profile/salon-profile.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { SALON_PROFILE_CONTRACTS } from '@kernel/domain/salon-profile/salon-profile.contracts';

export default defineEndpoint(
  SALON_PROFILE_CONTRACTS.SALON_PROFILE_VISIBILITY_GET,
  {
    handle: async ({ ctx, res, ok }) => {
      const { currentUser } = requireAuthenticatedContext(ctx);
      const accountCheck = requireStylistAccount(currentUser);
      if (!accountCheck.success) {
        return mapErrorToResponse(res, accountCheck.error);
      }
      const result = await getSalonProfileVisibility_IO({
        userId: accountCheck.data.created_by_user_id,
      });
      if (!result.success) {
        return mapErrorToResponse(res, result.error);
      }
      ok(result.data, APP_EVENTS.INFO.SALON_PROFILE.SALON_PROFILE_FETCHED);
    },
  }
);
