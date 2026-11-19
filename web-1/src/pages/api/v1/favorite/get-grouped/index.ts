import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { getFavoriteGrouped_IO } from '@domain/favorites/operations/favorite-grouping.operations';
import { FAVORITE_CONTRACTS } from '@kernel/domain/favorites/favorite.contracts';
import { requireClientAccount } from '@domain/_shared/guards/account-guards';
import { requireAuthenticatedContext } from '@domain/user/user.types';

export default defineEndpoint(FAVORITE_CONTRACTS.FAVORITE_GET_GROUPED, {
  handle: async ({ ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireClientAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    const result = await getFavoriteGrouped_IO({ id: currentUser.id });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    ok(result.data, APP_EVENTS.INFO.FAVORITE.FAVORITE_GROUPED_FETCHED);
  },
});
