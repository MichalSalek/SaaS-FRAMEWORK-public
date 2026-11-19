import { getEffectivePricingPlan } from '@kernel/domain/pricing/effective-plan';
import { redactAuditPayload } from '@app/event-log/event-log-io.wrapper';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { defineEndpoint } from '@app/http/define-endpoint';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { removeVisitResultPhoto_IO } from '@domain/visit/operations/visit-result-photo.operations';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { VISIT_CONTRACTS } from '@kernel/domain/visit/visit.contracts';

export default defineEndpoint(VISIT_CONTRACTS.REMOVE_VISIT_RESULT_PHOTO, {
  handle: async ({ input, ctx, res, ok, audit }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireStylistAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    const result = await removeVisitResultPhoto_IO({
      stylist_account_id: accountCheck.data.account_id,
      stylist_pricing_plan: getEffectivePricingPlan(accountCheck.data),
      visit_id: input.visit_id,
      photo_id: input.photo_id,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    audit(APP_EVENTS.INFO.VISIT.VISIT_RESULT_PHOTO_REMOVED, {
      user: { id: currentUser.id },
      requestBody: redactAuditPayload(input, ['visit_id', 'photo_id']),
      responseBody: { success: true },
    });

    ok({ success: true }, APP_EVENTS.INFO.VISIT.VISIT_RESULT_PHOTO_REMOVED);
  },
});
