import { kickSessionActivityOutbox } from '@domain/session-container/session-activity.outbox';
import { defineEndpoint } from '@app/http/define-endpoint';
import { respondOnError } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { setSessionContainerNote_IO } from '@domain/session-container/operations/session-container.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { redactAuditPayload } from '@app/event-log/event-log-io.wrapper';
import { SESSION_CONTAINER_CONTRACTS } from '@kernel/domain/session-container/session-container.contracts';

export default defineEndpoint(
  SESSION_CONTAINER_CONTRACTS.SESSION_CONTAINER_SET_NOTE,
  {
    handle: async ({ input, ctx, res, ok, audit }) => {
      const { currentUser } = requireAuthenticatedContext(ctx);
      const result = await setSessionContainerNote_IO({
        session_id: input.session_id,
        note: input.note,
        side: input.side,
        client_account_id: currentUser.client_account?.client_account_id,
        stylist_account_id: currentUser.stylist_account?.account_id,
        user_id: currentUser.id,
      });
      if (respondOnError(res, result)) {
        return;
      }

      // `note` is free-text. The audit row keeps session_id and side only.
      audit(APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_NOTE_UPDATED, {
        user: { id: currentUser.id },
        requestBody: redactAuditPayload(input, ['session_id', 'side']),
      });
      kickSessionActivityOutbox(input.session_id);
      ok(
        { session: result.data },
        APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_NOTE_UPDATED
      );
    },
  }
);
