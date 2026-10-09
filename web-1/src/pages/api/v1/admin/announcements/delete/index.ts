import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { adminDeleteAnnouncement_IO } from '@domain/admin/operations/admin-announcements.operations';

type DeleteRequest = ADMIN_DTO_API_V1['ADMIN_DELETE_ANNOUNCEMENT']['REQUEST'];
export default defineHandler<
  DeleteRequest,
  ADMIN_DTO_API_V1['ADMIN_DELETE_ANNOUNCEMENT']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.ADMIN.ADMIN_DELETE_ANNOUNCEMENT,
  method: 'post',
  validate: VALIDATION_POLICY.validators.adminDeleteAnnouncement,
  handle: async (body, ctx, _metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await adminDeleteAnnouncement_IO({
      id: body.id,
      currentUser,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(res, undefined, APP_EVENTS.INFO.ADMIN.ANNOUNCEMENT_DELETED);
  },
});
