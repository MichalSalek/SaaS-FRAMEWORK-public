import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { updateRecordNote_IO } from '@domain/favorites/operations/favorite-records.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import type { FAVORITE_DTO_API_V1 } from '@kernel/models/favorites/favorite.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { requireClientAccount } from '@domain/_shared/guards/account-guards';
export default defineHandler<
  FAVORITE_DTO_API_V1['FAVORITE_UPDATE_RECORD_NOTE']['REQUEST'],
  FAVORITE_DTO_API_V1['FAVORITE_UPDATE_RECORD_NOTE']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.FAVORITE.FAVORITE_UPDATE_RECORD_NOTE,
  method: 'post',
  validate: VALIDATION_POLICY.validators.favoriteUpdateRecordNote,
  handle: async (body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireClientAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    const result = await updateRecordNote_IO({
      gallery_record_id: body.gallery_record_id,
      id: currentUser.id,
      note: body.note ?? null,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.FAVORITE.FAVORITE_RECORD_NOTE_UPDATED,
        user: currentUser,
        requestBody: {
          gallery_record_id: body.gallery_record_id,
          note_length: body.note ? body.note.length : 0,
        },
        metadata,
      })
    );

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.FAVORITE.FAVORITE_RECORD_NOTE_UPDATED
    );
  },
});
