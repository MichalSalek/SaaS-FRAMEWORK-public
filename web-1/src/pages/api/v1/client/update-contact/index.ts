import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { updateClientContact_IO } from '@domain/client/operations/client-profile.operations';
import { CLIENT_CONTRACTS } from '@kernel/domain/client/client.contracts';
import { requireAuthenticatedContext } from '@domain/user/user.types';

// DECISION: forward contact_phone and contact_email only as the parser left them.
// An absent key is undefined (the column stays); '' and null clear the field.
// `|| undefined` would turn an explicit clear into a no-op. The audit row records
// which keys arrived. The values are contact PII and stay out of the log.
export default defineEndpoint(CLIENT_CONTRACTS.CLIENT_UPDATE_CONTACT, {
  handle: async ({ input, ctx, res, ok, audit }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await updateClientContact_IO({
      user_id: currentUser.id,
      contact_phone: input.contact_phone,
      contact_email: input.contact_email,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    audit(APP_EVENTS.INFO.CLIENT.CLIENT_CONTACT_UPDATED, {
      user: { id: currentUser.id },
      requestBody: {
        has_phone: 'contact_phone' in input,
        has_email: 'contact_email' in input,
      },
    });

    ok(
      {
        success: true,
        contact_phone: result.data.contact_phone,
        contact_email: result.data.contact_email,
      },
      APP_EVENTS.INFO.CLIENT.CLIENT_CONTACT_UPDATED
    );
  },
});
