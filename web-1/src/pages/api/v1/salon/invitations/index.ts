import { defineEndpoint } from '@app/http/define-endpoint';
import { respondOnError } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { requireSalonStaffEnabled } from '@app/feature-flags/feature-flags.guard';
import { getMyStaffInvitations_IO } from '@domain/salon-staff/operations/salon-staff-invitation.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { SALON_STAFF_CONTRACTS } from '@kernel/domain/salon-staff/salon-staff.contracts';

// Invitee side: the caller's own pending salon-team invitations.
// No account guard on purpose: the list is scoped by the session user id, and the
// permission sits in LOGGED_USER so it works in either active role.
export default defineEndpoint(
  SALON_STAFF_CONTRACTS.SALON_STAFF_GET_MY_INVITATIONS,
  {
    handle: async ({ ctx, res, ok }) => {
      const { currentUser } = requireAuthenticatedContext(ctx);

      if (!(await requireSalonStaffEnabled(res))) {
        return;
      }

      const result = await getMyStaffInvitations_IO({ userId: currentUser.id });
      if (respondOnError(res, result)) {
        return;
      }

      ok(
        result.data,
        APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_INVITATIONS_FETCHED
      );
    },
  }
);
