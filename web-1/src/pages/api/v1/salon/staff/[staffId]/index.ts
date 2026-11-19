import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondValidationFailed } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { parseStringIdQueryParam } from '@app/http/http.query.utils';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { requireSalonStaffEnabled } from '@app/feature-flags/feature-flags.guard';
import { getStaffMemberById_IO } from '@domain/salon-staff/operations/salon-staff-query.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { SALON_STAFF_CONTRACTS } from '@kernel/domain/salon-staff/salon-staff.contracts';

export default defineEndpoint(SALON_STAFF_CONTRACTS.SALON_STAFF_GET_BY_ID, {
  handle: async ({ ctx, req, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const targetStaffId = parseStringIdQueryParam(req.query.staffId);
    if (targetStaffId === null) {
      respondValidationFailed(res, undefined);
      return;
    }

    const accountCheck = requireStylistAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    if (!(await requireSalonStaffEnabled(res))) {
      return;
    }

    const result = await getStaffMemberById_IO({
      staffId: targetStaffId,
      accountId: accountCheck.data.account_id,
      pricingPlan: accountCheck.data.pricing_plan,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    ok(result.data, APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_FETCHED);
  },
});
