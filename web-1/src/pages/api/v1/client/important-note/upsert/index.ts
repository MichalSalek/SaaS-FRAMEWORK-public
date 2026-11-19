import { redactAuditPayload } from '@app/event-log/event-log-io.wrapper';
import { defineEndpoint } from '@app/http/define-endpoint';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { upsertClientImportantNote_IO } from '@domain/client/operations/client-important-note.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { CLIENT_CONTRACTS } from '@kernel/domain/client/client.contracts';

// An empty note clears the field in any pair state
// (see the DECISION in client-important-note.operations.ts).
export default defineEndpoint(CLIENT_CONTRACTS.CLIENT_UPSERT_IMPORTANT_NOTE, {
  handle: async ({ input, ctx, res, ok, audit }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireStylistAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    const result = await upsertClientImportantNote_IO({
      stylist_account_id: accountCheck.data.account_id,
      client_user_id: input.client_user_id,
      note: input.note,
      ...(input.expected_updated_at !== undefined
        ? { expected_updated_at: input.expected_updated_at }
        : {}),
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    audit(APP_EVENTS.INFO.CLIENT.CLIENT_IMPORTANT_NOTE_UPSERTED, {
      user: { id: currentUser.id },
      requestBody: redactAuditPayload(input, ['client_user_id']),
      responseBody: { updatedAt: result.data.updatedAt },
    });

    ok(result.data, APP_EVENTS.INFO.CLIENT.CLIENT_IMPORTANT_NOTE_UPSERTED);
  },
});
