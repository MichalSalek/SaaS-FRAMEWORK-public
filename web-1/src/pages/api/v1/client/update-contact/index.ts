import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import type { CLIENT_DTO_API_V1 } from '@kernel/models/client/client.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { updateClientContact_IO } from '@domain/client/operations/client-profile.operations';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  CLIENT_DTO_API_V1['CLIENT_UPDATE_CONTACT']['REQUEST'],
  CLIENT_DTO_API_V1['CLIENT_UPDATE_CONTACT']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.CLIENT.CLIENT_UPDATE_CONTACT,
  method: 'post',
  validate: VALIDATION_POLICY.validators.clientUpdateContact,
  handle: async (body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    // PATCH passthrough: forward the field ONLY when the request carried it. An
    // absent key is `undefined` (column left untouched by updateClientContact_IO);
    // an explicit '' is preserved (caller clearing the field → stored as null).
    // Do NOT `|| undefined` here — that would collapse an explicit clear into a
    // no-op and break the Partial<Pick<...>> contract (Wave 1-E #9).
    const result = await updateClientContact_IO({
      user_id: currentUser.id,
      contact_phone: body.contact_phone,
      contact_email: body.contact_email,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    const responsePayload: CLIENT_DTO_API_V1['CLIENT_UPDATE_CONTACT']['RESPONSE'] =
      {
        success: true,
        contact_phone: result.data.contact_phone,
        contact_email: result.data.contact_email,
      };

    // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
    // PII redaction: contact_phone/contact_email are PII (and would be stripped by
    // the recordAuditEvent_IO deny-list anyway). Log which fields the request carried
    // as boolean flags only — the audit signal is the mutation event + created_by_user_id.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.CLIENT.CLIENT_CONTACT_UPDATED,
        user: { id: currentUser.id },
        requestBody: {
          has_phone: 'contact_phone' in body,
          has_email: 'contact_email' in body,
        },
        metadata,
      })
    );

    respondSuccess(
      res,
      responsePayload,
      APP_EVENTS.INFO.CLIENT.CLIENT_CONTACT_UPDATED
    );
  },
});
