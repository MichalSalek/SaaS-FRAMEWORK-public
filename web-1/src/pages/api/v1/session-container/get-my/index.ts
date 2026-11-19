import { defineEndpoint } from '@app/http/define-endpoint';
import { respondOnError } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { getMySessionContainers_IO } from '@domain/session-container/operations/session-container.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { SESSION_CONTAINER_CONTRACTS } from '@kernel/domain/session-container/session-container.contracts';

export default defineEndpoint(
  SESSION_CONTAINER_CONTRACTS.SESSION_CONTAINER_GET_MY,
  {
    handle: async ({ input, ctx, res, ok, audit }) => {
      const { currentUser } = requireAuthenticatedContext(ctx);
      // DECISION: the list follows the ACTIVE role (`account_type`), not the accounts owned.
      // A two-account user used to get one merged list on both sides. A single-role user is unaffected.
      const isStylistView = currentUser.account_type === 'STYLIST';
      const result = await getMySessionContainers_IO({
        client_account_id: isStylistView
          ? undefined
          : currentUser.client_account?.client_account_id,
        stylist_account_id: isStylistView
          ? currentUser.stylist_account?.account_id
          : undefined,
        ...(input.cursor !== undefined && { cursor: input.cursor }),
        take: input.take,
      });
      if (respondOnError(res, result)) {
        return;
      }

      audit(APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINERS_FETCHED, {
        user: currentUser,
      });
      ok(
        result.data,
        APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINERS_FETCHED
      );
    },
  }
);
