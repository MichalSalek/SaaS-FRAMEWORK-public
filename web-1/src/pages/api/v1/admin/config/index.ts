import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { getAllRuntimeConfigs_IO } from '@domain/admin/operations/admin-runtime-config.operations';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler({
  eventName: APP_EVENTS.QUERIES.ADMIN.ADMIN_GET_CONFIGS,
  method: 'get',
  // Passthrough GET (no REQUEST body) — wired to the named validator like every
  // other passthrough sibling, instead of an inline noop (turbo-review S58).
  validate: VALIDATION_POLICY.validators.adminGetConfigs,
  handle: async (_body, ctx, _metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await getAllRuntimeConfigs_IO({ currentUser });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(res, result.data, APP_EVENTS.INFO.ADMIN.CONFIGS_FETCHED);
  },
});
