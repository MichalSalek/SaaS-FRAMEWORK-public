import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminPurgeDeletedUser_IO } from '@domain/admin/operations/admin-deleted-user.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';

// GDPR Art.17 hard-purge of a DeletedUser ARCHIVE row. MASTER_ADMIN-only via the
// COMMANDS.ADMIN wildcard (permissions.seed) + requireAdminPermission inside the operation.
// Command = POST. user_id (DeletedUser PK) comes from the validated body; admin identity from session.
export default defineHandler<
  ADMIN_DTO_API_V1['ADMIN_PURGE_DELETED_USER']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_PURGE_DELETED_USER']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.ADMIN.ADMIN_PURGE_DELETED_USER,
  method: 'post',
  validate: VALIDATION_POLICY.validators.purgeDeletedUser,
  handle: async (body, ctx, _metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await adminPurgeDeletedUser_IO({
      user_id: body.user_id,
      currentUser,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(res, undefined, APP_EVENTS.INFO.USER.USER_DELETED);
  },
});
