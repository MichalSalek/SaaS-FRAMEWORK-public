import { defineEndpoint } from '@app/http/define-endpoint';
import { respondOnError } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { requireClientAccount } from '@domain/_shared/guards/account-guards';
import { shareSessionContainer_IO } from '@domain/session-container/operations/session-container.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { kickSessionActivityOutbox } from '@domain/session-container/session-activity.outbox';
import { SESSION_CONTAINER_CONTRACTS } from '@kernel/domain/session-container/session-container.contracts';

export default defineEndpoint(
  SESSION_CONTAINER_CONTRACTS.SESSION_CONTAINER_SHARE,
  {
    handle: async ({ input, ctx, res, ok, audit }) => {
      const { currentUser } = requireAuthenticatedContext(ctx);
      const clientAccountResult = requireClientAccount(currentUser);
      if (respondOnError(res, clientAccountResult)) {
        return;
      }

      const result = await shareSessionContainer_IO({
        client_user_id: currentUser.id,
        client_account_id: clientAccountResult.data.client_account_id,
        session_id: input.session_id,
      });
      if (respondOnError(res, result)) {
        return;
      }

      audit(APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_SHARED, {
        user: currentUser,
        requestBody: input,
      });

      kickSessionActivityOutbox(input.session_id);

      ok(
        { session: result.data },
        APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_SHARED
      );
    },
  }
);
