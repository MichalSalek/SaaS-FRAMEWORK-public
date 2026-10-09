import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { getActiveAnnouncements_IO } from '@domain/admin/operations/admin-announcements.operations';
// DECISION (nie usuwaj tego komentarza):
// authCheck:false (parytet og-meta / runtime-config) — banner announcements montowany
// globalnie w shellu (AppLayout), odpalany na KAZDEJ trasie /app w tym /recover. Z
// authCheck:true token soft-deleted usera bylby rozwiazywany → 403 USER_DISABLED na
// account-state gate (5b) → falszywy toast + eviction z ekranu recovery (pelny rationale:
// runtime-config/index.ts). getActiveAnnouncements_IO nie bierze _ctx → dane czysto globalne
// (nie role-targeted), wiec pominiecie auth behavior-preserving.
export default defineHandler({
  eventName: APP_EVENTS.QUERIES.APPLICATION.ANNOUNCEMENTS_GET_ACTIVE,
  method: 'get',
  authCheck: false,
  validate: VALIDATION_POLICY.validators.announcementsGetActive,
  handle: async (_body, _ctx, _metadata, res) => {
    const result = await getActiveAnnouncements_IO();
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.APPLICATION.ACTIVE_ANNOUNCEMENTS_FETCHED
    );
  },
});
