import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import {
  respondSuccess,
  respondValidationFailed,
} from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { parseStringIdQueryParam } from '@app/http/http.query.utils';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { requireSalonStaffEnabled } from '@app/feature-flags/feature-flags.guard';
import type { SALON_STAFF_DTO_API_V1 } from '@kernel/models/salon-staff/salon-staff.dto';
import { getStaffMemberById_IO } from '@domain/salon-staff/operations/salon-staff-query.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  SALON_STAFF_DTO_API_V1['SALON_STAFF_GET_BY_ID']['REQUEST'],
  SALON_STAFF_DTO_API_V1['SALON_STAFF_GET_BY_ID']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.SALON_STAFF.SALON_STAFF_GET_BY_ID,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res, req) => {
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

    // SALON_STAFF_ENABLED back-guard (after RBAC, before operation). 404 when
    // feature is killed — prevents IDOR bypass of the front route gate.
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

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_FETCHED
    );
  },
});
