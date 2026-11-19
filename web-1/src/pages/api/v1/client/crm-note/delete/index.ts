import { redactAuditPayload } from '@app/event-log/event-log-io.wrapper';
import { defineEndpoint } from '@app/http/define-endpoint';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { deleteClientCrmNote_IO } from '@domain/client/operations/client-crm-note.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { CLIENT_CONTRACTS } from '@kernel/domain/client/client.contracts';

// Deletes a CRM note in any pair state (see the DECISION at deleteClientCrmNote_IO).
export default defineEndpoint(CLIENT_CONTRACTS.CLIENT_DELETE_CRM_NOTE, {
  handle: async ({ input, ctx, res, ok, audit }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireStylistAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    const result = await deleteClientCrmNote_IO({
      stylist_account_id: accountCheck.data.account_id,
      client_user_id: input.client_user_id,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    audit(APP_EVENTS.INFO.CLIENT.CLIENT_CRM_NOTE_DELETED, {
      user: { id: currentUser.id },
      requestBody: redactAuditPayload(input, ['client_user_id']),
    });

    ok(result.data, APP_EVENTS.INFO.CLIENT.CLIENT_CRM_NOTE_DELETED);
  },
});
