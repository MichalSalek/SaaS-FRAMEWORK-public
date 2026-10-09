import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondCreated } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { bookmarkStylist_IO } from '@domain/favorites/operations/bookmarked-stylists.operations';
import type { FAVORITE_DTO_API_V1 } from '@kernel/models/favorites/favorite.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { requireClientAccount } from '@domain/_shared/guards/account-guards';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  FAVORITE_DTO_API_V1['BOOKMARK_STYLIST']['REQUEST'],
  FAVORITE_DTO_API_V1['BOOKMARK_STYLIST']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.FAVORITE.BOOKMARK_STYLIST,
  method: 'post',
  validate: VALIDATION_POLICY.validators.bookmarkStylist,
  handle: async (body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireClientAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    const result = await bookmarkStylist_IO({
      stylist_account_id: body.stylist_account_id,
      id: currentUser.id,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    const responsePayload: FAVORITE_DTO_API_V1['BOOKMARK_STYLIST']['RESPONSE'] =
      {
        id: result.data.id,
        client_user_id: result.data.client_user_id,
        stylist_account_id: result.data.stylist_account_id,
      };

    // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.FAVORITE.STYLIST_BOOKMARKED,
        user: currentUser,
        requestBody: body,
        metadata,
      })
    );

    respondCreated(
      res,
      responsePayload,
      APP_EVENTS.INFO.FAVORITE.STYLIST_BOOKMARK_ADDED
    );
  },
});
