import { defineEndpoint } from '@app/http/define-endpoint';
import { ACCOUNT_CONTRACTS } from '@kernel/domain/account/account.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { incrementProfileView_IO } from '@domain/account/operations/account-profile.operations';
import { getCurrentUser_IO } from '@app/interceptors/domain-interceptors';
import { mapErrorToResponse } from '@app/http/error-mapper';
export default defineEndpoint(ACCOUNT_CONTRACTS.ACCOUNT_INCREMENT_VIEW, {
  handle: async ({ input: body, meta: userMetadata, res, req }) => {
    // DECISION: self-view exclusion via OPPORTUNISTIC auth. The endpoint is authCheck:false because the
    // normal caller is an ANONYMOUS public-profile visitor (authCheck:true would 401 them and break view
    // counting), but then the middleware never runs getCurrentUser_IO and ctx is always empty, which left
    // the owner self-view guard dead. So the viewer is resolved HERE, best-effort, from the session token:
    // getCurrentUser_IO never throws (a missing, invalid or expired bearer resolves ANONYMOUS), so an
    // anonymous or bad-token request still counts. Identity comes only from the session, never the body.
    // A valid stylist token passes her StylistAccount.account_id to the operation, whose "don't count,
    // return current view_count" branch (shared with the dedup hit) fires when viewer == target.
    // DECISION: UNAVAILABLE (the token could not be CHECKED) does NOT degrade to anonymous: that would
    // count the owner's own view. It answers 503 AUTH_UNAVAILABLE and the view is simply not counted.
    const resolution = await getCurrentUser_IO({ req, res });
    if (resolution.status === 'UNAVAILABLE') {
      return mapErrorToResponse(res, {
        type: 'AUTH_UNAVAILABLE',
        stage: resolution.stage,
      });
    }
    const viewer_account_id =
      resolution.output.currentUser?.stylist_account?.account_id ?? null;

    const result = await incrementProfileView_IO({
      stylist_account_id: body.stylist_account_id,
      client_ip: userMetadata.client_ip,
      viewer_account_id,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.ACCOUNT.PROFILE_VIEW_INCREMENTED
    );
  },
});
