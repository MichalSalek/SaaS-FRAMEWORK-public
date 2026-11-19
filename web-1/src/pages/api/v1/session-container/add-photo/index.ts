import { kickSessionActivityOutbox } from '@domain/session-container/session-activity.outbox';
import { defineEndpoint } from '@app/http/define-endpoint';
import { respondOnError } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { requireClientAccount } from '@domain/_shared/guards/account-guards';
import { addPhotoToSessionContainer_IO } from '@domain/session-container/operations/session-container.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { SESSION_CONTAINER_CONTRACTS } from '@kernel/domain/session-container/session-container.contracts';

export default defineEndpoint(
  SESSION_CONTAINER_CONTRACTS.SESSION_CONTAINER_ADD_PHOTO,
  {
    handle: async ({ input, ctx, res, created, audit }) => {
      const { currentUser } = requireAuthenticatedContext(ctx);
      const clientAccountResult = requireClientAccount(currentUser);
      if (respondOnError(res, clientAccountResult)) {
        return;
      }

      const result = await addPhotoToSessionContainer_IO({
        client_user_id: currentUser.id,
        client_account_id: clientAccountResult.data.client_account_id,
        session_id: input.session_id,
        gallery_record_id: input.gallery_record_id,
      });
      if (respondOnError(res, result)) {
        return;
      }

      audit(APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_PHOTO_ADDED, {
        user: currentUser,
        requestBody: input,
      });
      // DECISION: 201 Created. The dominant case inserts a SessionContainerPhoto row.
      // Re-adding the same photo is a silent no-op that still answers 201. Do NOT flip to 200.
      // Test: session-container-add-photo.operation.test.ts (repeat and unique constraint; not live concurrency).
      kickSessionActivityOutbox(input.session_id);
      created(
        { session: result.data },
        APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_PHOTO_ADDED
      );
    },
  }
);
