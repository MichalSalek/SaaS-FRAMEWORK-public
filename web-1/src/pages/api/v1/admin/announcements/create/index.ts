import { defineEndpoint } from '@app/http/define-endpoint';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminCreateAnnouncement_IO } from '@domain/admin/operations/admin-announcements.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';

export default defineEndpoint(ADMIN_CONTRACTS.ADMIN_CREATE_ANNOUNCEMENT, {
  handle: async ({ input: body, ctx, res, created }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await adminCreateAnnouncement_IO({
      title: body.title,
      message: body.message,
      type: body.type,
      is_active: body.is_active,
      ...(body.translations !== undefined
        ? { translations: body.translations }
        : {}),
      ...(body.audience_anonymous !== undefined
        ? { audience_anonymous: body.audience_anonymous }
        : {}),
      ...(body.audience_client !== undefined
        ? { audience_client: body.audience_client }
        : {}),
      ...(body.audience_stylist !== undefined
        ? { audience_stylist: body.audience_stylist }
        : {}),
      ...(body.starts_at ? { starts_at: body.starts_at } : {}),
      ...(body.ends_at ? { ends_at: body.ends_at } : {}),
      currentUser,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    created(result.data, APP_EVENTS.INFO.ADMIN.ANNOUNCEMENT_CREATED);
  },
});
