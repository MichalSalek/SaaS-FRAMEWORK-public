import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { defineEndpoint } from '@app/http/define-endpoint';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { respondValidationFailed } from '@app/http/http.responses.utils';
import { getEmailHistory_IO } from '@domain/email/operations/email-query.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';

export default defineEndpoint(ADMIN_CONTRACTS.ADMIN_GET_EMAIL_HISTORY, {
  handle: async ({ input, ctx, res, ok }) => {
    requireAuthenticatedContext(ctx);
    if (input.user_id === undefined) {
      return respondValidationFailed(res, { user_id: 'Required' });
    }
    const result = await getEmailHistory_IO(input.user_id, {
      cursor: input.cursor,
      take: input.take,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }
    ok(result.data, APP_EVENTS.INFO.EMAIL.EMAIL_HISTORY_FETCHED);
  },
});
