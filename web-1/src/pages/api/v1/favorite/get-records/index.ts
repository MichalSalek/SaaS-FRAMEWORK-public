import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { getFavoriteRecords_IO } from '@domain/favorites/operations/favorite-records.operations';
import { FAVORITE_CONTRACTS } from '@kernel/domain/favorites/favorite.contracts';
import { requireClientAccount } from '@domain/_shared/guards/account-guards';
import { requireAuthenticatedContext } from '@domain/user/user.types';

// GET: `cursor` and `take` are decoded from the query string by the contract's query fields
// (take defaults to 50, an unreadable value falls back, it is never a 400).
export default defineEndpoint(FAVORITE_CONTRACTS.FAVORITE_GET_RECORDS, {
  handle: async ({ input, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireClientAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    const result = await getFavoriteRecords_IO({
      id: currentUser.id,
      ...(input.cursor !== undefined && { cursor: input.cursor }),
      take: input.take,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    ok(result.data, APP_EVENTS.INFO.FAVORITE.FAVORITE_RECORDS_FETCHED);
  },
});
