import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import {
  recordAuditEvent_IO,
  redactAuditPayload,
} from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondCreated } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { addRecordToFavorites_IO } from '@domain/favorites/operations/favorite-records.operations';
import type { FAVORITE_DTO_API_V1 } from '@kernel/models/favorites/favorite.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { requireClientAccount } from '@domain/_shared/guards/account-guards';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  FAVORITE_DTO_API_V1['FAVORITE_ADD_RECORD']['REQUEST'],
  FAVORITE_DTO_API_V1['FAVORITE_ADD_RECORD']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.FAVORITE.FAVORITE_ADD_RECORD,
  method: 'post',
  validate: VALIDATION_POLICY.validators.favoriteAddRecord,
  handle: async (body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireClientAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    const result = await addRecordToFavorites_IO({
      gallery_record_id: body.gallery_record_id,
      id: currentUser.id,
      note: body.note !== undefined ? body.note : null,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    const responsePayload: FAVORITE_DTO_API_V1['FAVORITE_ADD_RECORD']['RESPONSE'] =
      {
        id: result.data.id,
        client_user_id: result.data.client_user_id,
        gallery_record_id: result.data.gallery_record_id,
        note: result.data.note ?? null,
      };

    // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.FAVORITE.FAVORITE_RECORD_ADDED,
        user: currentUser,
        requestBody: redactAuditPayload(body, ['gallery_record_id']),
        metadata,
      })
    );

    respondCreated(
      res,
      responsePayload,
      APP_EVENTS.INFO.FAVORITE.FAVORITE_RECORD_ADDED
    );
  },
});
