import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { unbookmarkStylist_IO } from '@domain/favorites/operations/bookmarked-stylists.operations';
import type { FAVORITE_DTO_API_V1 } from '@kernel/models/favorites/favorite.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { requireClientAccount } from '@domain/_shared/guards/account-guards';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  FAVORITE_DTO_API_V1['UNBOOKMARK_STYLIST']['REQUEST'],
  FAVORITE_DTO_API_V1['UNBOOKMARK_STYLIST']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.FAVORITE.UNBOOKMARK_STYLIST,
  method: 'post',
  validate: VALIDATION_POLICY.validators.unbookmarkStylist,
  handle: async (body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireClientAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    const result = await unbookmarkStylist_IO({
      stylist_account_id: body.stylist_account_id,
      id: currentUser.id,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }
    const deleted = result.data;

    // DECISION (nie usuwaj tego komentarza):
    // Unbookmark-not-bookmarked zwraca idempotent 200 success zamiast 404.
    // Unbookmark jest operacją idempotentną — cel (brak bookmarku) jest osiągnięty
    // niezależnie od tego, czy rekord istniał. 404 łamałoby idempotentność i
    // zmuszałoby klientów do ignorowania błędu. STYLIST_NOT_BOOKMARKED event
    // logowany dla observability, ale status odpowiedzi to 200.
    const responsePayload: FAVORITE_DTO_API_V1['UNBOOKMARK_STYLIST']['RESPONSE'] =
      {
        success: true,
      };

    if (!deleted) {
      runAfterResponse(() =>
        recordAuditEvent_IO({
          eventName: APP_EVENTS.INFO.FAVORITE.STYLIST_NOT_BOOKMARKED,
          user: currentUser,
          requestBody: body,
          metadata,
        })
      );
      respondSuccess(
        res,
        responsePayload,
        APP_EVENTS.INFO.FAVORITE.STYLIST_NOT_BOOKMARKED
      );
      return;
    }

    // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.FAVORITE.STYLIST_UNBOOKMARKED,
        user: currentUser,
        requestBody: body,
        metadata,
      })
    );

    respondSuccess(
      res,
      responsePayload,
      APP_EVENTS.INFO.FAVORITE.STYLIST_UNBOOKMARKED
    );
  },
});
