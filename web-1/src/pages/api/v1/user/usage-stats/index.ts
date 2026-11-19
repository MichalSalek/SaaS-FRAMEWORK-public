import { getEffectivePricingPlan } from '@kernel/domain/pricing/effective-plan';
import { defineEndpoint } from '@app/http/define-endpoint';
import { USER_CONTRACTS } from '@kernel/domain/user/user.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { getUsageStats_IO } from '@domain/user/operations/user-query.operations';
export default defineEndpoint(USER_CONTRACTS.USER_GET_USAGE_STATS, {
  handle: async ({ ctx, res }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);

    // DECISION: the active role decides the account context, NOT stylist_account presence. A dual-role user
    // in the CLIENT role who still carries a legacy/orphan stylist_account must get CLIENT-appropriate
    // stats; feeding the dormant stylist account's id + pricing_plan reported the wrong plan (e.g.
    // PRO/unlimited) and counted stylist-only metrics for a client. Mirrors the role gating in
    // pairing/get-my-pairs and pairing/revoke-access (currentUser.role_id === STYLIST_ROLE). Outside the
    // stylist role both stylist-derived inputs stay undefined, so getUsageStats_IO falls back to FREE +
    // zeroed stylist counts (client-side metrics still resolve by user id).
    const isStylistRole = currentUser.role_id === SystemRoleId.STYLIST_ROLE;
    const stylistAccount = isStylistRole
      ? currentUser.stylist_account
      : undefined;

    const result = await getUsageStats_IO({
      userId: currentUser.id,
      stylistAccountId: stylistAccount?.account_id,
      pricingPlan: stylistAccount
        ? getEffectivePricingPlan(stylistAccount)
        : undefined,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(res, result.data, APP_EVENTS.INFO.APPLICATION.SUCCESS);
  },
});
