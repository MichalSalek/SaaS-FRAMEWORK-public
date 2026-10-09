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
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import type {
  StaffRole,
  StaffPermission,
} from '@kernel/domain/user-and-account/staff_accounts.config';
import type { SALON_STAFF_DTO_API_V1 } from '@kernel/models/salon-staff/salon-staff.dto';
import { updateStaffPermissions_IO } from '@domain/salon-staff/operations/salon-staff-management.operations';
import {
  recordAuditEvent_IO,
  redactAuditPayload,
} from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  SALON_STAFF_DTO_API_V1['SALON_STAFF_UPDATE_PERMISSIONS']['REQUEST'],
  SALON_STAFF_DTO_API_V1['SALON_STAFF_UPDATE_PERMISSIONS']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.SALON_STAFF.SALON_STAFF_UPDATE_PERMISSIONS,
  method: 'patch',
  validate: VALIDATION_POLICY.validators.salonStaffUpdate,
  handle: async (body, ctx, metadata, res, req) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const targetStaffId = parseStringIdQueryParam(req.query.staffId);
    const { permissions, role } = body as {
      permissions?: StaffPermission[];
      role?: StaffRole;
    };

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

    const result = await updateStaffPermissions_IO({
      staffId: targetStaffId,
      accountId: accountCheck.data.account_id,
      pricingPlan: accountCheck.data.pricing_plan,
      permissions,
      role,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
    // Audit payload: role + permissions (non-PII operational context) plus the
    // targeted staffId. Actor user_id is captured via the `user` arg.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_PERMISSIONS_UPDATED,
        user: currentUser,
        requestBody: {
          staffId: targetStaffId,
          ...redactAuditPayload(body as Record<string, unknown>, [
            'role',
            'permissions',
          ]),
        },
        metadata,
      })
    );

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_PERMISSIONS_UPDATED
    );
  },
});
