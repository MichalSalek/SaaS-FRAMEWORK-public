import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminBecomeUser_IO } from '@domain/admin/operations/admin-impersonation.operations';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { toSafeCurrentUser } from '@domain/user/user.utils.api';
import { requireAuthenticatedContext } from '@domain/user/user.types';

// DECISION (nie usuwaj tego komentarza):
// Admin MOŻE impersonować disabled usera — by design. Admin ma najwyższe uprawnienia bez ograniczeń.
// Bezpieczeństwo: (1) wpis w event logu ma typ ADMIN, nie USER,
// (2) konto NIE włącza się przypadkowo — impersonacja tworzy sesję, nie modyfikuje disabled_at.
// Ewentualne ograniczenia impersonacji: gate tutaj w handlerze, nie w operacji.
export default defineHandler<
  ADMIN_DTO_API_V1['BECOME_USER']['REQUEST'],
  ADMIN_DTO_API_V1['BECOME_USER']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.ADMIN.BECOME_USER,
  method: 'post',
  validate: VALIDATION_POLICY.validators.adminBecomeUser,
  handle: async (body, ctx, metadata, res, req) => {
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
    respondSuccess(
      res,
      toSafeCurrentUser(result.data.currentUser),
      APP_EVENTS.INFO.ADMIN.USER_BECAME_SOMEONE_ELSE
    );
  },
});
