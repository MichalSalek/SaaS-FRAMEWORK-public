import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { adminUpdateAnnouncement_IO } from '@domain/admin/operations/admin-announcements.operations';

type UpdateRequest = ADMIN_DTO_API_V1['ADMIN_UPDATE_ANNOUNCEMENT']['REQUEST'];
export default defineHandler<
  UpdateRequest,
  ADMIN_DTO_API_V1['ADMIN_UPDATE_ANNOUNCEMENT']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.ADMIN.ADMIN_UPDATE_ANNOUNCEMENT,
  method: 'post',
  validate: VALIDATION_POLICY.validators.adminUpdateAnnouncement,
  handle: async (body, ctx, _metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await adminUpdateAnnouncement_IO({
      id: body.id,
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.message !== undefined ? { message: body.message } : {}),
      ...(body.type !== undefined ? { type: body.type } : {}),
      ...(body.is_active !== undefined ? { is_active: body.is_active } : {}),
      ...(body.starts_at !== undefined ? { starts_at: body.starts_at } : {}),
      ...(body.ends_at !== undefined ? { ends_at: body.ends_at } : {}),
      currentUser,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(res, undefined, APP_EVENTS.INFO.ADMIN.ANNOUNCEMENT_UPDATED);
  },
});
