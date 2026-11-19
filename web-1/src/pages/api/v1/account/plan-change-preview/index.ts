import { defineEndpoint } from '@app/http/define-endpoint';
import { ACCOUNT_CONTRACTS } from '@kernel/domain/account/account.contracts';
import { planChangeSchema } from '@kernel/domain/account/account.contract-schemas';
import {
  respondSuccess,
  respondValidationFailed,
} from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { previewPaidPlanChange_IO } from '@domain/account/operations/plan-change-quote.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';

export default defineEndpoint(ACCOUNT_CONTRACTS.ACCOUNT_PLAN_CHANGE_PREVIEW, {
  handle: async ({ input, ctx, res }) => {
    // The contract query is a required string on the client and still decodes
    // as optional. The plan schema rejects a missing or unknown value before IO.
    const parsed = planChangeSchema.safeParse({
      targetPlanId: input.targetPlanId,
      billingPeriod: input.billingPeriod,
    });
    if (!parsed.success) {
      respondValidationFailed(res, undefined);
      return;
    }

    const { session } = requireAuthenticatedContext(ctx);
    const result = await previewPaidPlanChange_IO({
      userId: session.userId,
      targetPlanId: parsed.data.targetPlanId,
      billingPeriod: parsed.data.billingPeriod,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(res, result.data);
  },
});
