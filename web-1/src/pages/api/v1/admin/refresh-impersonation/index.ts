import { defineEndpoint } from '@app/http/define-endpoint';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { SWITCH_BACK_TOKEN_NAME } from '@app/admin/become-user.config';
import { getClientHeader } from '@app/headers/headers.utils';
import { respondBadRequest } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminRefreshImpersonation_IO } from '@domain/admin/operations/admin-impersonation.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineEndpoint(ADMIN_CONTRACTS.REFRESH_IMPERSONATION, {
  handle: async ({ ctx, res, req, ok }) => {
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

    ok(result.data, APP_EVENTS.INFO.ADMIN.IMPERSONATION_REFRESHED);
  },
});
