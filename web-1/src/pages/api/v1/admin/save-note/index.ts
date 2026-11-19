import { defineEndpoint } from '@app/http/define-endpoint';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondBadRequest } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { saveNote_IO } from '@domain/admin/operations/admin-notes.operations';
export default defineEndpoint(ADMIN_CONTRACTS.SAVE_NOTE, {
  handle: async ({ input: body, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    if (!body.notes) {
      respondBadRequest(
        res,
        APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED,
        undefined
      );
      return;
    }

    const result = await saveNote_IO({ notes: body.notes, currentUser });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    ok(result.data, APP_EVENTS.INFO.APPLICATION.SUCCESS);
  },
});
