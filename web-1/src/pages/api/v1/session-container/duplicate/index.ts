import { defineEndpoint } from '@app/http/define-endpoint';
import { respondOnError } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { SESSION_CONTAINER_CONTRACTS } from '@kernel/domain/session-container/session-container.contracts';
import { requireClientAccount } from '@domain/_shared/guards/account-guards';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { duplicateSessionContainer_IO } from '@domain/session-container/operations/session-container-duplicate.operation';

export default defineEndpoint(
  SESSION_CONTAINER_CONTRACTS.SESSION_CONTAINER_DUPLICATE,
  {
    handle: async ({ input, ctx, res, ok, audit }) => {
      const { currentUser } = requireAuthenticatedContext(ctx);
      const clientAccount = requireClientAccount(currentUser);
      if (respondOnError(res, clientAccount)) {
        return;
      }
      const result = await duplicateSessionContainer_IO({
        client_user_id: currentUser.id,
        client_account_id: clientAccount.data.client_account_id,
        session_id: input.session_id,
      });
      if (respondOnError(res, result)) {
        return;
      }
      audit(APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_DUPLICATED, {
        user: currentUser,
        requestBody: { session_id: input.session_id },
      });
      ok(
        { session: result.data },
        APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_DUPLICATED
      );
    },
  }
);
