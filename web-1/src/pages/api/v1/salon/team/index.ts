import { requireSalonStaffEnabled } from '@app/feature-flags/feature-flags.guard';
import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { getMySalonTeams_IO } from '@domain/salon-staff/operations/salon-team.operations';
import { SALON_STAFF_CONTRACTS } from '@kernel/domain/salon-staff/salon-staff.contracts';

export default defineEndpoint(SALON_STAFF_CONTRACTS.SALON_STAFF_GET_MY_TEAM, {
  handle: async ({ ctx, res, ok }) => {
    if (!(await requireSalonStaffEnabled(res))) {
      return;
    }
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await getMySalonTeams_IO(currentUser.id);
    if (!result.success) {
      mapErrorToResponse(res, result.error);
      return;
    }
    ok(result.data, APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_FETCHED);
  },
});
