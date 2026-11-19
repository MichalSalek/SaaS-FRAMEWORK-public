import { defineEndpoint } from '@app/http/define-endpoint';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { checkAccessUrl_IO } from '@domain/admin/operations/admin-check-access.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineEndpoint(ADMIN_CONTRACTS.ADMIN_CHECK_ACCESS, {
  handle: async ({ input: body, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await checkAccessUrl_IO({ url: body.url, currentUser });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    const raw = result.data.data;
    const data = JSON.parse(JSON.stringify(raw === undefined ? null : raw));
    ok(
      {
        status: result.data.status,
        statusText: result.data.statusText,
        headers: result.data.headers,
        data,
      },
      APP_EVENTS.INFO.APPLICATION.SUCCESS
    );
  },
});
