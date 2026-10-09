import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import {
  respondBadRequest,
  respondSuccess,
} from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { saveNote_IO } from '@domain/admin/operations/admin-notes.operations';
export default defineHandler<
  ADMIN_DTO_API_V1['SAVE_NOTE']['REQUEST'],
  ADMIN_DTO_API_V1['SAVE_NOTE']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.ADMIN.SAVE_NOTE,
  method: 'post',
  validate: VALIDATION_POLICY.validators.adminSaveNote,
  handle: async (body, ctx, _metadata, res) => {
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

    respondSuccess(res, result.data, APP_EVENTS.INFO.APPLICATION.SUCCESS);
  },
});
