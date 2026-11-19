import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { updateRecordNote_IO } from '@domain/favorites/operations/favorite-records.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { FAVORITE_CONTRACTS } from '@kernel/domain/favorites/favorite.contracts';
import { requireClientAccount } from '@domain/_shared/guards/account-guards';

export default defineEndpoint(FAVORITE_CONTRACTS.FAVORITE_UPDATE_RECORD_NOTE, {
  handle: async ({ input, ctx, res, ok, audit }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireClientAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    const result = await updateRecordNote_IO({
      gallery_record_id: input.gallery_record_id,
      id: currentUser.id,
      note: input.note,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    audit(APP_EVENTS.INFO.FAVORITE.FAVORITE_RECORD_NOTE_UPDATED, {
      user: currentUser,
      requestBody: {
        gallery_record_id: input.gallery_record_id,
        note_length: input.note ? input.note.length : 0,
      },
    });

    ok(result.data, APP_EVENTS.INFO.FAVORITE.FAVORITE_RECORD_NOTE_UPDATED);
  },
});
