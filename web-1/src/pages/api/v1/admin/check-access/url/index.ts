import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { checkAccessUrl_IO } from '@domain/admin/operations/admin-check-access.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<{ url?: string }>({
  eventName: APP_EVENTS.COMMANDS.ADMIN.ADMIN_CHECK_ACCESS,
  method: 'post',
  validate: VALIDATION_POLICY.validators.adminCheckAccessUrl,
  handle: async (body, ctx, _metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await checkAccessUrl_IO({ url: body.url, currentUser });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(res, result.data, APP_EVENTS.INFO.APPLICATION.SUCCESS);
  },
});
