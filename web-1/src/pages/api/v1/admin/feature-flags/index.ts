import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminGetFeatureFlags_IO } from '@domain/admin/operations/admin-feature-flags.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler({
  eventName: APP_EVENTS.QUERIES.ADMIN.ADMIN_GET_FEATURE_FLAGS,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await adminGetFeatureFlags_IO({ currentUser });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.ADMIN.FEATURE_FLAGS_FETCHED
    );
  },
});
