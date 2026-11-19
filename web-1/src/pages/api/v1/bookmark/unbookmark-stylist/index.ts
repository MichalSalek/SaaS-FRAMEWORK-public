import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { unbookmarkStylist_IO } from '@domain/favorites/operations/bookmarked-stylists.operations';
import { FAVORITE_CONTRACTS } from '@kernel/domain/favorites/favorite.contracts';
import { requireClientAccount } from '@domain/_shared/guards/account-guards';
import { requireAuthenticatedContext } from '@domain/user/user.types';

export default defineEndpoint(FAVORITE_CONTRACTS.UNBOOKMARK_STYLIST, {
  handle: async ({ input, ctx, res, ok, audit }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireClientAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    const result = await unbookmarkStylist_IO({
      stylist_account_id: input.stylist_account_id,
      id: currentUser.id,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // DECISION: unbookmarking a stylist who is not bookmarked returns an idempotent 200, not 404: the
    // target state (no bookmark) is reached either way, and a 404 would force clients to ignore the error.
    // STYLIST_NOT_BOOKMARKED is logged for observability only.
    const event = result.data
      ? APP_EVENTS.INFO.FAVORITE.STYLIST_UNBOOKMARKED
      : APP_EVENTS.INFO.FAVORITE.STYLIST_NOT_BOOKMARKED;
    audit(event, { user: currentUser, requestBody: input });
    ok({ success: true }, event);
  },
});
