import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { removeRecordFromFavorites_IO } from '@domain/favorites/operations/favorite-records.operations';
import { FAVORITE_CONTRACTS } from '@kernel/domain/favorites/favorite.contracts';
import { requireClientAccount } from '@domain/_shared/guards/account-guards';
import { requireAuthenticatedContext } from '@domain/user/user.types';

export default defineEndpoint(FAVORITE_CONTRACTS.FAVORITE_REMOVE_RECORD, {
  handle: async ({ input, ctx, res, ok, audit }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireClientAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    const result = await removeRecordFromFavorites_IO({
      gallery_record_id: input.gallery_record_id,
      id: currentUser.id,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // DECISION: removing a record that is not favorited returns an idempotent 200, not 404 (deleteMany
    // never throws): the target state is reached either way, and a 404 would break double-tap unlike or a
    // record removed by cascade. Same payload { success: true } as unbookmark-stylist;
    // RECORD_NOT_IN_FAVORITES is logged for observability only.
    const event = result.data
      ? APP_EVENTS.INFO.FAVORITE.RECORD_REMOVED_FROM_FAVORITES
      : APP_EVENTS.INFO.FAVORITE.RECORD_NOT_IN_FAVORITES;
    audit(event, { user: currentUser, requestBody: input });
    ok({ success: true }, event);
  },
});
