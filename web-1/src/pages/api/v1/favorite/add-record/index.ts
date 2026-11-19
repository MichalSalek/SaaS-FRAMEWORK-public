import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { redactAuditPayload } from '@app/event-log/event-log-io.wrapper';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { addRecordToFavorites_IO } from '@domain/favorites/operations/favorite-records.operations';
import { FAVORITE_CONTRACTS } from '@kernel/domain/favorites/favorite.contracts';
import { requireClientAccount } from '@domain/_shared/guards/account-guards';
import { requireAuthenticatedContext } from '@domain/user/user.types';

export default defineEndpoint(FAVORITE_CONTRACTS.FAVORITE_ADD_RECORD, {
  handle: async ({ input, ctx, res, created, audit }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireClientAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    const result = await addRecordToFavorites_IO({
      gallery_record_id: input.gallery_record_id,
      id: currentUser.id,
      note: input.note !== undefined ? input.note : null,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    audit(APP_EVENTS.INFO.FAVORITE.FAVORITE_RECORD_ADDED, {
      user: currentUser,
      requestBody: redactAuditPayload(input, ['gallery_record_id']),
    });

    created(
      {
        id: result.data.id,
        client_user_id: result.data.client_user_id,
        gallery_record_id: result.data.gallery_record_id,
        note: result.data.note ?? null,
      },
      APP_EVENTS.INFO.FAVORITE.FAVORITE_RECORD_ADDED
    );
  },
});
