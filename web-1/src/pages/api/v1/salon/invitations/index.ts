import { defineHandler, respondOnError } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { requireSalonStaffEnabled } from '@app/feature-flags/feature-flags.guard';
import type { SALON_STAFF_DTO_API_V1 } from '@kernel/models/salon-staff/salon-staff.dto';
import { getMyStaffInvitations_IO } from '@domain/salon-staff/operations/salon-staff-invitation.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';

// Invitee side (2026-09-25): the caller's own pending salon-team invitations.
// No account guard on purpose: the list is scoped by the session user id, and the
// permission sits in LOGGED_USER so it works in either active role (DECISION in
// role-permissions.ts).
export default defineHandler<
  SALON_STAFF_DTO_API_V1['SALON_STAFF_GET_MY_INVITATIONS']['REQUEST'],
  SALON_STAFF_DTO_API_V1['SALON_STAFF_GET_MY_INVITATIONS']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.SALON_STAFF.SALON_STAFF_GET_MY_INVITATIONS,
  method: 'get',
  // GET carries no body; the explicit no-op is the repo form every query handler
  // uses (validation-coverage gates a handler with no `validate:` key at all).
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);

    // SALON_STAFF_ENABLED back-guard: the kill-switch covers the whole feature,
    // the invitee side included (404 when off, parity with the roster endpoints).
    if (!(await requireSalonStaffEnabled(res))) {
      return;
    }

    const result = await getMyStaffInvitations_IO({ userId: currentUser.id });
    if (respondOnError(res, result)) {
      return;
    }

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_INVITATIONS_FETCHED
    );
  },
});
