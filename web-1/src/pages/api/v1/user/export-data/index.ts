import { defineEndpoint } from '@app/http/define-endpoint';
import { USER_CONTRACTS } from '@kernel/domain/user/user.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { exportUserData_IO } from '@domain/user/operations/export-user-data.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineEndpoint(USER_CONTRACTS.USER_EXPORT_DATA, {
  handle: async ({ ctx, res }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await exportUserData_IO({ currentUser });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(res, result.data, APP_EVENTS.INFO.USER.USER_DATA_EXPORTED);
  },
});
