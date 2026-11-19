import { getEffectivePricingPlan } from '@kernel/domain/pricing/effective-plan';
import { respondOnError } from '@app/http/define-handler';
import { defineEndpoint } from '@app/http/define-endpoint';
import { ACCOUNT_CONTRACTS } from '@kernel/domain/account/account.contracts';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { respondSuccess } from '@app/http/http.responses.utils';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { getPrivateNotes_IO } from '@domain/private-notes/operations/private-notes-query.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';

// /api/v1/account/get-private-notes — the stylist's private notes hub (/app/notes).
// SECURITY: the stylist account comes from the session (requireStylistAccount); the optional
// client filter only narrows her own rows.
export default defineEndpoint(ACCOUNT_CONTRACTS.ACCOUNT_GET_PRIVATE_NOTES, {
  handle: async ({ input, ctx, res }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireStylistAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    const result = await getPrivateNotes_IO({
      stylist_account_id: accountCheck.data.account_id,
      stylist_pricing_plan: getEffectivePricingPlan(accountCheck.data),
      client_user_id: input.client_user_id,
    });
    if (respondOnError(res, result)) {
      return;
    }
    respondSuccess(res, result.data);
  },
});
