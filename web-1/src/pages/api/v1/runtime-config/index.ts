import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { getPublicRuntimeConfig_IO } from '@domain/admin/operations/admin-runtime-config.operations';

// Public (no-auth) GET — narrow runtime-config projection ({ maintenanceMessage, verboseLogMode }).
// SECURITY: the op exposes ONLY these two intentionally-public knobs — the maintenance-banner
// message and verboseLogMode (client verbose-logging flag, public by design; see the DECISION
// comment on getPublicRuntimeConfig_IO). No other runtime knob leaks.
// DECISION (nie usuwaj tego komentarza):
// authCheck:false (parytet og-meta) — banner montowany globalnie (PublicLayout + AppLayout),
// odpalany na KAŻDEJ trasie w tym /app/user/recover. Z authCheck:true token soft-deleted
// (RECOVERABLE/EXPIRED/ban) usera JEST rozwiazywany → przechodzi BASE_PERMISSIONS → wywala sie
// na account-state gate (5b, request.middleware) → 403 USER_DISABLED → event-pipeline: falszywy
// toast + STATE_FULL_RESET + UNCONDITIONAL redirect na /user/login = eviction z ekranu recovery
// (pętla z useLoggedInRedirectGuard). Dane sa czysto globalne (op nie bierze _ctx), wiec
// pominiecie auth jest bezpieczne: getCurrentUser_IO nie odpala → 5b nigdy nie strzela, anon i
// soft-deleted dostaja identyczna odpowiedz co przedtem anon.
export default defineHandler({
  eventName: APP_EVENTS.QUERIES.APPLICATION.GET_RUNTIME_CONFIG_PUBLIC,
  method: 'get',
  authCheck: false,
  validate: () => ({ __isValid: true }),
  handle: async (_body, _ctx, _metadata, res) => {
    const result = await getPublicRuntimeConfig_IO();
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.APPLICATION.PUBLIC_RUNTIME_CONFIG_FETCHED
    );
  },
});
