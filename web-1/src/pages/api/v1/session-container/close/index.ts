import { defineEndpoint } from '@app/http/define-endpoint';
import { respondOnError } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { closeSessionContainer_IO } from '@domain/session-container/operations/session-container.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { emitInfoEvent } from '@app/events/event-bus';
import { SESSION_CONTAINER_CONTRACTS } from '@kernel/domain/session-container/session-container.contracts';

export default defineEndpoint(
  SESSION_CONTAINER_CONTRACTS.SESSION_CONTAINER_CLOSE,
  {
    handle: async ({ input, ctx, res, ok, audit }) => {
      const { currentUser } = requireAuthenticatedContext(ctx);
      const result = await closeSessionContainer_IO({
        client_account_id: currentUser.client_account?.client_account_id,
        stylist_account_id: currentUser.stylist_account?.account_id,
        session_id: input.session_id,
        user_id: currentUser.id,
      });
      if (respondOnError(res, result)) {
        return;
      }

      audit(APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_CLOSED, {
        user: currentUser,
        requestBody: input,
      });

      // The client learns that her stylist closed the session after the visit.
      // A client closing her own session tells nobody. Listener: session-closed.listener.
      const closedByStylist =
        result.data.stylistAccountId !== null &&
        result.data.stylistAccountId ===
          currentUser.stylist_account?.account_id &&
        result.data.clientAccountId !==
          currentUser.client_account?.client_account_id;
      if (closedByStylist && result.data.stylistAccountId) {
        emitInfoEvent(
          APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_CLOSED,
          {
            sessionId: input.session_id,
            clientAccountId: result.data.clientAccountId,
            stylistAccountId: result.data.stylistAccountId,
            closedByUserId: currentUser.id,
          }
        );
      }

      ok(
        { session: result.data },
        APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_CLOSED
      );
    },
  }
);
