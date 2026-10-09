import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { removeRecordFromFavorites_IO } from '@domain/favorites/operations/favorite-records.operations';
import { defineHandler } from '@app/http/define-handler';
import type { FAVORITE_DTO_API_V1 } from '@kernel/models/favorites/favorite.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { requireClientAccount } from '@domain/_shared/guards/account-guards';
import { requireAuthenticatedContext } from '@domain/user/user.types';

export default defineHandler<
  FAVORITE_DTO_API_V1['FAVORITE_REMOVE_RECORD']['REQUEST'],
  FAVORITE_DTO_API_V1['FAVORITE_REMOVE_RECORD']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.FAVORITE.FAVORITE_REMOVE_RECORD,
  method: 'post',
  validate: VALIDATION_POLICY.validators.favoriteRemoveRecord,
  handle: async (body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireClientAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    const result = await removeRecordFromFavorites_IO({
      gallery_record_id: body.gallery_record_id,
      id: currentUser.id,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }
    const deleted = result.data;

    // DECISION (nie usuwaj tego komentarza):
    // Remove-record-not-favorited zwraca idempotent 200 success zamiast 404.
    // Remove jest operacją idempotentną (deleteMany → success(count>0), bez throw) —
    // cel (rekord nie jest polubiony) jest osiągnięty niezależnie od tego, czy wiersz
    // istniał. 404 łamałoby idempotentność i zmuszałoby klientów do ignorowania błędu
    // przy double-tap-unlike lub gdy rekord został usunięty kaskadowo.
    // Parytet z unbookmarkStylist (bookmark/unbookmark-stylist/index.ts): payload
    // { success: true } w obu ścieżkach (identyczne zachowanie dwóch endpointów delete),
    // RECORD_NOT_IN_FAVORITES logowany dla observability, ale status odpowiedzi to 200.
    const responsePayload: FAVORITE_DTO_API_V1['FAVORITE_REMOVE_RECORD']['RESPONSE'] =
      {
        success: true,
      };

    if (!deleted) {
      runAfterResponse(() =>
        recordAuditEvent_IO({
          eventName: APP_EVENTS.INFO.FAVORITE.RECORD_NOT_IN_FAVORITES,
          user: currentUser,
          requestBody: body,
          metadata,
        })
      );
      respondSuccess(
        res,
        responsePayload,
        APP_EVENTS.INFO.FAVORITE.RECORD_NOT_IN_FAVORITES
      );
      return;
    }

    // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.FAVORITE.RECORD_REMOVED_FROM_FAVORITES,
        user: currentUser,
        requestBody: body,
        metadata,
      })
    );

    respondSuccess(
      res,
      responsePayload,
      APP_EVENTS.INFO.FAVORITE.RECORD_REMOVED_FROM_FAVORITES
    );
  },
});
