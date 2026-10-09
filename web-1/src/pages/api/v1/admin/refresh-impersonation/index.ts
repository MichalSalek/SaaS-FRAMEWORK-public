import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { SWITCH_BACK_TOKEN_NAME } from '@app/admin/become-user.config';
import { getClientHeader } from '@app/headers/headers.utils';
import {
  respondBadRequest,
  respondSuccess,
} from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminRefreshImpersonation_IO } from '@domain/admin/operations/admin-impersonation.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
export default defineHandler<
  ADMIN_DTO_API_V1['REFRESH_IMPERSONATION']['REQUEST'],
  ADMIN_DTO_API_V1['REFRESH_IMPERSONATION']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.ADMIN.REFRESH_IMPERSONATION,
  method: 'post',
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res, req) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const backupHeaderRaw = await getClientHeader({
      req,
      res,
      payload: SWITCH_BACK_TOKEN_NAME,
    });

    if (!backupHeaderRaw) {
      respondBadRequest(res, APP_EVENTS.INFO.ADMIN.INVALID_BACKUP, undefined);
      return;
    }

    const result = await adminRefreshImpersonation_IO({
      currentUser,
      backupHeaderRaw,
      req,
      res,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.ADMIN.IMPERSONATION_REFRESHED
    );
  },
});
