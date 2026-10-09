import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import {
  respondBadRequest,
  respondSuccess,
} from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { setMainNote_IO } from '@domain/admin/operations/admin-notes.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  ADMIN_DTO_API_V1['SET_MAIN_NOTE']['REQUEST'],
  ADMIN_DTO_API_V1['SET_MAIN_NOTE']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.ADMIN.SET_MAIN_NOTE,
  method: 'post',
  validate: VALIDATION_POLICY.validators.adminSetMainNote,
  handle: async (body, ctx, _metadata, res) => {
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

    respondSuccess(res, undefined, APP_EVENTS.INFO.ADMIN.NOTE_SET);
  },
});
