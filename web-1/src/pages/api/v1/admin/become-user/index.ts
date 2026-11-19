import { defineEndpoint } from '@app/http/define-endpoint';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminBecomeUser_IO } from '@domain/admin/operations/admin-impersonation.operations';
import { toSafeCurrentUser } from '@domain/user/user.utils.api';
import { requireAuthenticatedContext } from '@domain/user/user.types';

// DECISION: an admin MAY impersonate a disabled user, by design (admin has the highest privileges). Safe
// because (1) the event log entry is ADMIN type, not USER, and (2) the account is not re-enabled by
// accident (impersonation creates a session and does not touch disabled_at). Any impersonation
// restrictions belong here in the handler, not in the operation.
export default defineEndpoint(ADMIN_CONTRACTS.BECOME_USER, {
  handle: async ({ input: body, ctx, meta: metadata, res, req, ok }) => {
    const { currentUser, session } = requireAuthenticatedContext(ctx);
    const result = await adminBecomeUser_IO({
      body,
      currentUser,
      session,
      metadata,
      req,
      res,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // SECURITY: strip session.token + session.userId before serializing.
    // Token persists in Authorization header (out-of-band) + DB; never in body.
    ok(
      toSafeCurrentUser(result.data.currentUser),
      APP_EVENTS.INFO.ADMIN.USER_BECAME_SOMEONE_ELSE
    );
  },
});
