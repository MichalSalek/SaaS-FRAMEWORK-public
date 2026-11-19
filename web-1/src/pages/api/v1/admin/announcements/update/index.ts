import { defineEndpoint } from '@app/http/define-endpoint';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { adminUpdateAnnouncement_IO } from '@domain/admin/operations/admin-announcements.operations';

export default defineEndpoint(ADMIN_CONTRACTS.ADMIN_UPDATE_ANNOUNCEMENT, {
  handle: async ({ input: body, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await adminUpdateAnnouncement_IO({
      id: body.id,
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

    ok(undefined, APP_EVENTS.INFO.ADMIN.ANNOUNCEMENT_UPDATED);
  },
});
