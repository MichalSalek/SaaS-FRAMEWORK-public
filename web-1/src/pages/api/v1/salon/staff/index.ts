import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { emitInfoEvent } from '@app/events/event-bus';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { requireSalonStaffEnabled } from '@app/feature-flags/feature-flags.guard';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { getAllStaffMembers_IO } from '@domain/salon-staff/operations/salon-staff-query.operations';
import { inviteStaffMember_IO } from '@domain/salon-staff/operations/salon-staff-management.operations';
import { sendStaffInvitationNotification } from '@domain/salon-staff/salon-staff-invite-notification.service';
import { redactAuditPayload } from '@app/event-log/event-log-io.wrapper';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { bindEndpoint, defineEndpointSwitch } from '@app/http/define-endpoint';
import { SALON_STAFF_CONTRACTS } from '@kernel/domain/salon-staff/salon-staff.contracts';

const getAll = bindEndpoint(
  SALON_STAFF_CONTRACTS.SALON_STAFF_GET_ALL,
  async ({ ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireStylistAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    // SALON_STAFF_ENABLED back-guard (after RBAC, before operation). 404 when
    // feature is killed — prevents IDOR bypass of the front route gate.
    if (!(await requireSalonStaffEnabled(res))) {
      return;
    }

    const result = await getAllStaffMembers_IO({
      accountId: accountCheck.data.account_id,
      pricingPlan: accountCheck.data.pricing_plan,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    ok(result.data, APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_FETCHED);
  }
);

const invite = bindEndpoint(
  SALON_STAFF_CONTRACTS.SALON_STAFF_INVITE,
  async ({ input, ctx, res, created, audit }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const { email, role } = input;

    const accountCheck = requireStylistAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    // SALON_STAFF_ENABLED back-guard (after RBAC, before operation). 404 when
    // feature is killed — prevents IDOR bypass of the front route gate.
    if (!(await requireSalonStaffEnabled(res))) {
      return;
    }

    const result = await inviteStaffMember_IO({
      email,
      role,
      accountId: accountCheck.data.account_id,
      pricingPlan: accountCheck.data.pricing_plan,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    audit(APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_INVITED, {
      user: currentUser,
      requestBody: redactAuditPayload(input, ['role']),
    });
    // Invitation delivery is awaited before the request finishes; only audit logging
    // belongs after-response. Existing-account consent remains inside the mail service.
    await sendStaffInvitationNotification({
      staffMemberId: result.data.staff.id,
      ...(result.data.invitationToken && {
        invitationToken: result.data.invitationToken,
      }),
    });
    // Notifications v2: a NEW invitation (token present = freshly created)
    // becomes a row for an invitee who already has an account
    // (listener salon-staff-invited resolves the account by e-mail).
    if (result.data.invitationToken) {
      emitInfoEvent(APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_INVITED, {
        invitationId: result.data.staff.id,
        salonAccountId: accountCheck.data.account_id,
      });
    }

    created(
      { staff: result.data.staff },
      APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_INVITED
    );
  }
);

export default defineEndpointSwitch([getAll, invite]);
