import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { getBookmarkedStylists_IO } from '@domain/favorites/operations/bookmarked-stylists.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { FAVORITE_CONTRACTS } from '@kernel/domain/favorites/favorite.contracts';
import { requireClientAccount } from '@domain/_shared/guards/account-guards';

// GET: `cursor` and `take` are decoded from the query string by the contract's query fields
// (take defaults to 50, an unreadable value falls back, it is never a 400).
export default defineEndpoint(FAVORITE_CONTRACTS.GET_BOOKMARKED_STYLISTS, {
  handle: async ({ input, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireClientAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    const result = await getBookmarkedStylists_IO({
      id: currentUser.id,
      ...(input.cursor !== undefined && { cursor: input.cursor }),
      take: input.take,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    ok(result.data, APP_EVENTS.INFO.FAVORITE.BOOKMARKED_STYLISTS_FETCHED);
  },
});
