import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { respondCreated } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminCreateAnnouncement_IO } from '@domain/admin/operations/admin-announcements.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';

type CreateRequest = ADMIN_DTO_API_V1['ADMIN_CREATE_ANNOUNCEMENT']['REQUEST'];
export default defineHandler<
  CreateRequest,
  ADMIN_DTO_API_V1['ADMIN_CREATE_ANNOUNCEMENT']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.ADMIN.ADMIN_CREATE_ANNOUNCEMENT,
  method: 'post',
  validate: VALIDATION_POLICY.validators.adminCreateAnnouncement,
  handle: async (body, ctx, _metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await adminCreateAnnouncement_IO({
      title: body.title,
      message: body.message,
      type: body.type,
      is_active: body.is_active,
      ...(body.starts_at ? { starts_at: body.starts_at } : {}),
      ...(body.ends_at ? { ends_at: body.ends_at } : {}),
      currentUser,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondCreated(
      res,
      result.data,
      APP_EVENTS.INFO.ADMIN.ANNOUNCEMENT_CREATED
    );
  },
});
