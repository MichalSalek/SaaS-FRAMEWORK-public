import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { defineEndpoint } from '@app/http/define-endpoint';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { getPublicRuntimeConfig_IO } from '@domain/admin/operations/admin-runtime-config.operations';
import { APPLICATION_CONTRACTS } from '@kernel/domain/application/application.contracts';

// DECISION: authCheck:false (parity with og-meta). The maintenance banner is mounted globally (PublicLayout
// + AppLayout) and fires on EVERY route including /app/user/recover. With authCheck:true the token of a
// soft-deleted user is resolved, passes BASE_PERMISSIONS and fails the account-state gate, which evicts
// her from recovery. The payload is global, so skipping auth keeps anonymous and recovering callers
// on the same response. The allow-list is the contract response.
export default defineEndpoint(APPLICATION_CONTRACTS.GET_RUNTIME_CONFIG_PUBLIC, {
  handle: async ({ res, ok }) => {
    const result = await getPublicRuntimeConfig_IO();
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }
    ok(result.data, APP_EVENTS.INFO.APPLICATION.PUBLIC_RUNTIME_CONFIG_FETCHED);
  },
});
