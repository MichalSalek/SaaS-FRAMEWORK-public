import { defineEndpoint } from '@app/http/define-endpoint';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { SWITCH_BACK_TOKEN_NAME } from '@app/admin/become-user.config';
import { getClientHeader } from '@app/headers/headers.utils';
import { respondBadRequest } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminSwitchBackToSelf_IO } from '@domain/admin/operations/admin-impersonation.operations';
import { toSafeCurrentUser } from '@domain/user/user.utils.api';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineEndpoint(ADMIN_CONTRACTS.SWITCH_BACK_BECOME_USER, {
  handle: async ({ ctx, meta: metadata, res, req, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    // Get original user profile from backup header
    const backupHeaderRaw = await getClientHeader({
      req,
      res,
      payload: SWITCH_BACK_TOKEN_NAME,
    });

    if (!backupHeaderRaw) {
      respondBadRequest(
        res,
        APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED,
        undefined
      );
      return;
    }

    const result = await adminSwitchBackToSelf_IO({
      currentUser,
      backupHeaderRaw,
      _metadata: metadata,
      req,
      res,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // SECURITY: strip session.token + session.userId before serializing.
    // Original admin token re-issued via Authorization header (out-of-band) + DB; never in body.
    ok(
      toSafeCurrentUser(result.data),
      APP_EVENTS.INFO.ADMIN.USER_SWITCHED_BACK_TO_SELF
    );
  },
});
