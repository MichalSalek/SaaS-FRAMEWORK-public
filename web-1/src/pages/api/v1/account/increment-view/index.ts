import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { incrementProfileView_IO } from '@domain/account/operations/account-profile.operations';
import { getCurrentUser_IO } from '@app/interceptors/domain-interceptors';
import type { ACCOUNT_DTO_API_V1 } from '@kernel/models/account/account.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { mapErrorToResponse } from '@app/http/error-mapper';
export default defineHandler<
  ACCOUNT_DTO_API_V1['ACCOUNT_INCREMENT_VIEW']['REQUEST'],
  ACCOUNT_DTO_API_V1['ACCOUNT_INCREMENT_VIEW']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.ACCOUNT.ACCOUNT_INCREMENT_VIEW,
  method: 'post',
  authCheck: false,
  validate: VALIDATION_POLICY.validators.accountIncrementView,
  handle: async (body, _ctx, userMetadata, res, req) => {
    // DECISION (nie usuwaj tego komentarza):
    // Self-view exclusion via OPPORTUNISTIC (optional) auth. This endpoint is
    // authCheck:false because the normal caller is an ANONYMOUS public-profile
    // visitor — flipping authCheck:true would 401 them and break view counting.
    // But authCheck:false means the middleware NEVER runs getCurrentUser_IO, so
    // the ctx it hands us is always the empty object (that was the bug: the
    // owner self-view guard was dead code, the owner inflated their own count).
    // We therefore resolve the viewer OURSELVES, best-effort, from the session
    // token: getCurrentUser_IO is total (try/catch → empty context; a missing,
    // invalid, or expired bearer token yields no user and NEVER throws), so an
    // anonymous or bad-token request still counts the view. Identity comes ONLY
    // from the session, never the body. When a valid stylist token IS present,
    // their StylistAccount.account_id reaches the operation, whose "don't count,
    // return current view_count" branch (shared with the dedup hit) fires when
    // viewer == target — so the owner's own visit does not inflate the count.
    const { currentUser } = await getCurrentUser_IO({ req, res });
    const viewer_account_id = currentUser?.stylist_account?.account_id ?? null;

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
