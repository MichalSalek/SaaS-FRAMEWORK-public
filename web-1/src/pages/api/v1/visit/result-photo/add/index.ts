import { getEffectivePricingPlan } from '@kernel/domain/pricing/effective-plan';
import { redactAuditPayload } from '@app/event-log/event-log-io.wrapper';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { defineEndpoint } from '@app/http/define-endpoint';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { addVisitResultPhoto_IO } from '@domain/visit/operations/visit-result-photo.operations';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { VISIT_CONTRACTS } from '@kernel/domain/visit/visit.contracts';

export default defineEndpoint(VISIT_CONTRACTS.ADD_VISIT_RESULT_PHOTO, {
  handle: async ({ input, ctx, res, created, audit }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireStylistAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    const result = await addVisitResultPhoto_IO({
      stylist_account_id: accountCheck.data.account_id,
      stylist_pricing_plan: getEffectivePricingPlan(accountCheck.data),
      visit_id: input.visit_id,
      asset_url: input.asset_url,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    audit(APP_EVENTS.INFO.VISIT.VISIT_RESULT_PHOTO_ADDED, {
      user: { id: currentUser.id },
      requestBody: redactAuditPayload(input, ['visit_id']),
      responseBody: { photo_id: result.data.id },
    });

    created(
      { photo: result.data },
      APP_EVENTS.INFO.VISIT.VISIT_RESULT_PHOTO_ADDED
    );
  },
});
