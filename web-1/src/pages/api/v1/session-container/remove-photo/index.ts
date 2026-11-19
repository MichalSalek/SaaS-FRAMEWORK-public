import { kickSessionActivityOutbox } from '@domain/session-container/session-activity.outbox';
import { defineEndpoint } from '@app/http/define-endpoint';
import { respondOnError } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { requireClientAccount } from '@domain/_shared/guards/account-guards';
import { removePhotoFromSessionContainer_IO } from '@domain/session-container/operations/session-container.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { SESSION_CONTAINER_CONTRACTS } from '@kernel/domain/session-container/session-container.contracts';

export default defineEndpoint(
  SESSION_CONTAINER_CONTRACTS.SESSION_CONTAINER_REMOVE_PHOTO,
  {
    handle: async ({ input, ctx, res, ok, audit }) => {
      const { currentUser } = requireAuthenticatedContext(ctx);
      const clientAccountResult = requireClientAccount(currentUser);
      if (respondOnError(res, clientAccountResult)) {
        return;
      }

      const result = await removePhotoFromSessionContainer_IO({
        client_user_id: currentUser.id,
        client_account_id: clientAccountResult.data.client_account_id,
        session_id: input.session_id,
        gallery_record_id: input.gallery_record_id,
      });
      if (respondOnError(res, result)) {
        return;
      }

      audit(APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_PHOTO_REMOVED, {
        user: currentUser,
        requestBody: input,
      });
      // 200: a removal creates nothing, and a repeated removal is the same answer.
      kickSessionActivityOutbox(input.session_id);
      ok(
        { session: result.data },
        APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_PHOTO_REMOVED
      );
    },
  }
);
