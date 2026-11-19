import { defineEndpoint } from '@app/http/define-endpoint';
import { respondOnError } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { requireClientAccount } from '@domain/_shared/guards/account-guards';
import { createSessionContainer_IO } from '@domain/session-container/operations/session-container.operations';
import { redactAuditPayload } from '@app/event-log/event-log-io.wrapper';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { SESSION_CONTAINER_CONTRACTS } from '@kernel/domain/session-container/session-container.contracts';

export default defineEndpoint(
  SESSION_CONTAINER_CONTRACTS.SESSION_CONTAINER_CREATE,
  {
    handle: async ({ input, ctx, res, created, audit }) => {
      const { currentUser } = requireAuthenticatedContext(ctx);
      const clientAccountResult = requireClientAccount(currentUser);
      if (respondOnError(res, clientAccountResult)) {
        return;
      }

      const result = await createSessionContainer_IO({
        client_user_id: currentUser.id,
        client_account_id: clientAccountResult.data.client_account_id,
        stylist_account_id: input.stylist_account_id ?? undefined,
        name: input.name ?? undefined,
      });
      if (respondOnError(res, result)) {
        return;
      }

      audit(APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_CREATED, {
        user: currentUser,
        requestBody: redactAuditPayload(input, ['stylist_account_id']),
      });
      created(
        { session: result.data },
        APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_CREATED
      );
    },
  }
);
