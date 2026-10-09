import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { getFeatureFlagsPublic_IO } from '@domain/admin/operations/admin-feature-flags.operations';
// DECISION (nie usuwaj tego komentarza):
// authCheck:false (parytet og-meta / runtime-config) — public flags czytane przez
// PublicFooter na kazdej LP ORAZ przez AppLayout (usePublicFeatureFlag EXPLORE_ENABLED) na
// kazdej trasie /app w tym /recover. Z authCheck:true token soft-deleted usera bylby
// rozwiazywany → 403 USER_DISABLED na account-state gate (5b) → falszywy toast + eviction
// (pelny rationale: runtime-config/index.ts). getFeatureFlagsPublic_IO nie bierze _ctx → dane
// czysto globalne (key→enabled), wiec pominiecie auth behavior-preserving.
export default defineHandler({
  eventName: APP_EVENTS.QUERIES.ADMIN.GET_FEATURE_FLAGS_PUBLIC,
  method: 'get',
  authCheck: false,
  validate: () => ({ __isValid: true }),
  handle: async (_body, _ctx, _metadata, res) => {
    const result = await getFeatureFlagsPublic_IO();
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
