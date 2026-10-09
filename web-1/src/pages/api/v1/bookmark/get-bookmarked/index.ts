import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { getBookmarkedStylists_IO } from '@domain/favorites/operations/bookmarked-stylists.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import type { FAVORITE_DTO_API_V1 } from '@kernel/models/favorites/favorite.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { requireClientAccount } from '@domain/_shared/guards/account-guards';
import { qStr, qInt } from '@app/http/query-params.utils';
export default defineHandler<
  FAVORITE_DTO_API_V1['GET_BOOKMARKED_STYLISTS']['REQUEST'],
  FAVORITE_DTO_API_V1['GET_BOOKMARKED_STYLISTS']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.FAVORITE.GET_BOOKMARKED_STYLISTS,
  method: 'get',
  validate: VALIDATION_POLICY.validators.getBookmarkedStylists,
  handle: async (_body, ctx, _metadata, res, req) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireClientAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    const cursor = qStr(req.query, 'cursor') ?? undefined;
    const take = qInt(req.query, 'take') ?? 50;

    const result = await getBookmarkedStylists_IO({
      id: currentUser.id,
      ...(cursor !== undefined && { cursor }),
      take,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.FAVORITE.BOOKMARKED_STYLISTS_FETCHED
    );
  },
});
