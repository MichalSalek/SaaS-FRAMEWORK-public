import { defineEndpoint } from '@app/http/define-endpoint';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { testAnnouncementNotification_IO } from '@domain/admin/operations/announcement-test.operations';

export default defineEndpoint(
  ADMIN_CONTRACTS.ADMIN_TEST_ANNOUNCEMENT_NOTIFICATION,
  {
    handle: async ({ input, ctx, res, ok, audit }) => {
      const { currentUser } = requireAuthenticatedContext(ctx);
      const result = await testAnnouncementNotification_IO({
        id: input.id,
        locale: input.locale,
        currentUser,
      });
      if (!result.success) {
        return mapErrorToResponse(res, result.error);
      }
      audit(APP_EVENTS.INFO.ADMIN.ANNOUNCEMENT_UPDATED, {
        user: { id: currentUser.id },
        requestBody: {
          id: input.id,
          action: 'TEST_NOTIFICATION',
          locale: input.locale,
        },
      });
      ok(result.data, APP_EVENTS.INFO.APPLICATION.SUCCESS);
    },
  }
);
