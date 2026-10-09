import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { getUsageStats_IO } from '@domain/user/operations/user-query.operations';
export default defineHandler<
  USER_DTO_API_V1['USER_GET_USAGE_STATS']['REQUEST'],
  USER_DTO_API_V1['USER_GET_USAGE_STATS']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.USER.USER_GET_USAGE_STATS,
  method: 'get',
  validate: VALIDATION_POLICY.validators.userGetUsageStats,
  handle: async (_body, ctx, _metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);

    // DECISION (nie usuwaj tego komentarza):
    // Active role decides the account context, NOT stylist_account presence. A
    // dual-role user (CLIENT role still carrying a legacy/orphan stylist_account) must
    // get CLIENT-appropriate usage stats — feeding the dormant stylist account's id +
    // pricing_plan reported the wrong plan (e.g. PRO/unlimited) and counted stylist-only
    // metrics for a client. Mirrors the role gating in pairing/get-my-pairs +
    // pairing/revoke-access (currentUser.role_id === STYLIST_ROLE). When not in stylist
    // role both stylist-derived inputs stay undefined → getUsageStats_IO falls back to
    // FREE + zeroed stylist counts (client-side metrics still resolve by user id).
    const isStylistRole = currentUser.role_id === SystemRoleId.STYLIST_ROLE;
    const stylistAccount = isStylistRole
      ? currentUser.stylist_account
      : undefined;

    const result = await getUsageStats_IO({
      userId: currentUser.id,
      stylistAccountId: stylistAccount?.account_id,
      pricingPlan: stylistAccount?.pricing_plan,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(res, result.data, APP_EVENTS.INFO.APPLICATION.SUCCESS);
  },
});
