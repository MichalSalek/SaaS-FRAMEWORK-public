import { defineEndpoint } from '@app/http/define-endpoint';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondBadRequest } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { setMainNote_IO } from '@domain/admin/operations/admin-notes.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineEndpoint(ADMIN_CONTRACTS.SET_MAIN_NOTE, {
  handle: async ({ input: body, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    if (!body.id) {
      respondBadRequest(
        res,
        APP_EVENTS.INFO.APPLICATION.GENERAL_ERROR,
        undefined
      );
      return;
    }

    const result = await setMainNote_IO({ noteId: body.id, currentUser });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    ok(undefined, APP_EVENTS.INFO.ADMIN.NOTE_SET);
  },
});
