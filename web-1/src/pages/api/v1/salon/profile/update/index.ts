import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { updateSalonProfile_IO } from '@domain/salon-profile/salon-profile.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { salonProfileResponse } from '@kernel/domain/salon-profile/salon-profile.contract-schemas';
import { SALON_PROFILE_CONTRACTS } from '@kernel/domain/salon-profile/salon-profile.contracts';

export default defineEndpoint(SALON_PROFILE_CONTRACTS.SALON_PROFILE_UPDATE, {
  handle: async ({ input, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireStylistAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }
    const result = await updateSalonProfile_IO({
      accountId: accountCheck.data.account_id,
      body: input,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }
    ok(
      salonProfileResponse(result.data),
      APP_EVENTS.INFO.SALON_PROFILE.SALON_PROFILE_UPDATED
    );
  },
});
