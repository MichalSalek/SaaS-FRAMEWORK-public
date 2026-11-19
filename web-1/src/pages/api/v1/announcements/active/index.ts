import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { defineEndpoint } from '@app/http/define-endpoint';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { getActiveAnnouncements_IO } from '@domain/admin/operations/admin-announcements.operations';
import { APPLICATION_CONTRACTS } from '@kernel/domain/application/application.contracts';
import { getCurrentUser_IO } from '@domain/user/operations/user-session.operations';

// DECISION: public/recovery pages must work anonymously. Resolve a supplied session here without
// the account-state redirect gate; private audience data still requires an active role account.
export default defineEndpoint(APPLICATION_CONTRACTS.ANNOUNCEMENTS_GET_ACTIVE, {
  handle: async ({ input, req, res, ok }) => {
    const resolution = await getCurrentUser_IO({ req, res });
    if (resolution.status === 'UNAVAILABLE') {
      return mapErrorToResponse(res, {
        type: 'AUTH_UNAVAILABLE',
        stage: resolution.stage,
      });
    }
    const user = resolution.output.currentUser;
    const active =
      user &&
      user.is_active &&
      user.deleted_at === null &&
      user.disabled_at === null;
    const viewer =
      active &&
      (user.account_type === 'CLIENT'
        ? user.client_account
        : user.stylist_account)
        ? user.account_type
        : null;
    const result = await getActiveAnnouncements_IO({
      viewer,
      surface: input.surface ?? 'public',
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }
    ok(result.data, APP_EVENTS.INFO.APPLICATION.ACTIVE_ANNOUNCEMENTS_FETCHED);
  },
});
