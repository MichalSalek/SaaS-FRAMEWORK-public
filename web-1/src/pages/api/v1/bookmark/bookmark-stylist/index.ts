import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { bookmarkStylist_IO } from '@domain/favorites/operations/bookmarked-stylists.operations';
import { FAVORITE_CONTRACTS } from '@kernel/domain/favorites/favorite.contracts';
import { requireClientAccount } from '@domain/_shared/guards/account-guards';
import { requireAuthenticatedContext } from '@domain/user/user.types';

export default defineEndpoint(FAVORITE_CONTRACTS.BOOKMARK_STYLIST, {
  handle: async ({ input, ctx, res, created, audit }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireClientAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    const result = await bookmarkStylist_IO({
      stylist_account_id: input.stylist_account_id,
      id: currentUser.id,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    audit(APP_EVENTS.INFO.FAVORITE.STYLIST_BOOKMARKED, {
      user: currentUser,
      requestBody: input,
    });

    created(
      {
        id: result.data.id,
        client_user_id: result.data.client_user_id,
        stylist_account_id: result.data.stylist_account_id,
      },
      APP_EVENTS.INFO.FAVORITE.STYLIST_BOOKMARK_ADDED
    );
  },
});
