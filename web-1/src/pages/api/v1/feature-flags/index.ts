import { defineEndpoint } from '@app/http/define-endpoint';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { getFeatureFlagsPublic_IO } from '@domain/admin/operations/admin-feature-flags.operations';
// DECISION: authCheck:false (parity with og-meta / runtime-config): public flags are read by PublicFooter
// on every LP and by AppLayout (usePublicFeatureFlag EXPLORE_ENABLED) on every /app route, /recover
// included. Rationale: runtime-config/index.ts. getFeatureFlagsPublic_IO takes no _ctx and the data is
// purely global (key -> enabled), so skipping auth preserves behavior.
export default defineEndpoint(ADMIN_CONTRACTS.GET_FEATURE_FLAGS_PUBLIC, {
  handle: async ({ res, ok }) => {
    const result = await getFeatureFlagsPublic_IO();
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    ok(result.data, APP_EVENTS.INFO.ADMIN.FEATURE_FLAGS_FETCHED);
  },
});
