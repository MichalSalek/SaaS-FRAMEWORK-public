import { defineEndpoint } from '@app/http/define-endpoint';
import { ACCOUNT_CONTRACTS } from '@kernel/domain/account/account.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { dismissGalleryStrength_IO } from '@domain/account/operations/account-gallery-strength.operations';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { requireAuthenticatedContext } from '@domain/user/user.types';

export default defineEndpoint(
  ACCOUNT_CONTRACTS.ACCOUNT_DISMISS_GALLERY_STRENGTH,
  {
    handle: async ({ ctx, meta: metadata, res }) => {
      const { currentUser } = requireAuthenticatedContext(ctx);
      const stylistAccount = requireStylistAccount(currentUser);
      if (!stylistAccount.success) {
        return mapErrorToResponse(res, stylistAccount.error);
      }

      const result = await dismissGalleryStrength_IO(
        stylistAccount.data.account_id
      );

      if (!result.success) {
        return mapErrorToResponse(res, result.error);
      }

      runAfterResponse(() =>
        recordAuditEvent_IO({
          eventName: APP_EVENTS.INFO.ACCOUNT.GALLERY_STRENGTH_DISMISSED,
          user: { id: currentUser.id },
          requestBody: {},
          metadata,
        })
      );

      respondSuccess(
        res,
        result.data,
        APP_EVENTS.INFO.ACCOUNT.GALLERY_STRENGTH_DISMISSED
      );
    },
  }
);
