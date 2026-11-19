import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondValidationFailed } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { parseStringIdQueryParam } from '@app/http/http.query.utils';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { requireSalonStaffEnabled } from '@app/feature-flags/feature-flags.guard';
import { updateStaffPermissions_IO } from '@domain/salon-staff/operations/salon-staff-management.operations';
import { redactAuditPayload } from '@app/event-log/event-log-io.wrapper';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { SALON_STAFF_CONTRACTS } from '@kernel/domain/salon-staff/salon-staff.contracts';

export default defineEndpoint(
  SALON_STAFF_CONTRACTS.SALON_STAFF_UPDATE_PERMISSIONS,
  {
    handle: async ({ input, ctx, req, res, ok, audit }) => {
      const { currentUser } = requireAuthenticatedContext(ctx);
      const targetStaffId = parseStringIdQueryParam(req.query.staffId);
      const { permissions } = input;

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

      const result = await updateStaffPermissions_IO({
        staffId: targetStaffId,
        accountId: accountCheck.data.account_id,
        pricingPlan: accountCheck.data.pricing_plan,
        permissions,
      });
      if (!result.success) {
        return mapErrorToResponse(res, result.error);
      }

      audit(APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_PERMISSIONS_UPDATED, {
        user: currentUser,
        requestBody: {
          staffId: targetStaffId,
          ...redactAuditPayload(input, ['permissions']),
        },
      });

      ok(
        result.data,
        APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_PERMISSIONS_UPDATED
      );
    },
  }
);
