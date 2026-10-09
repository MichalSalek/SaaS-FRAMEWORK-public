import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { getFavoriteGrouped_IO } from '@domain/favorites/operations/favorite-grouping.operations';
import type { FAVORITE_DTO_API_V1 } from '@kernel/models/favorites/favorite.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { requireClientAccount } from '@domain/_shared/guards/account-guards';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  FAVORITE_DTO_API_V1['FAVORITE_GET_GROUPED']['REQUEST'],
  FAVORITE_DTO_API_V1['FAVORITE_GET_GROUPED']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.FAVORITE.FAVORITE_GET_GROUPED,
  method: 'get',
  validate: VALIDATION_POLICY.validators.favoriteGetGrouped,
  handle: async (_body, ctx, _metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireClientAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    const result = await getFavoriteGrouped_IO({ id: currentUser.id });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.FAVORITE.FAVORITE_GROUPED_FETCHED
    );
  },
});
