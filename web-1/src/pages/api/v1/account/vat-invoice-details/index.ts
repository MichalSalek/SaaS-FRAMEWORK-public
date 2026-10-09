import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { saveVatInvoiceDetails_IO } from '@app/stripe/vat-invoice.operations';
import type { ACCOUNT_DTO_API_V1 } from '@kernel/models/account/account.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { requireAuthenticatedContext } from '@domain/user/user.types';

export default defineHandler<
  ACCOUNT_DTO_API_V1['ACCOUNT_VAT_INVOICE_DETAILS']['REQUEST'],
  ACCOUNT_DTO_API_V1['ACCOUNT_VAT_INVOICE_DETAILS']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.ACCOUNT.ACCOUNT_VAT_INVOICE_DETAILS,
  method: 'post',
  validate: VALIDATION_POLICY.validators.vatInvoiceDetails,
  handle: async (body, ctx, metadata, res) => {
    // userId ZAWSZE z sesji, NIGDY z body.
    const { session } = requireAuthenticatedContext(ctx);
    const result = await saveVatInvoiceDetails_IO({
      userId: session.userId,
      companyName: body.companyName,
      nip: body.nip,
      addressLine1: body.addressLine1,
      addressCity: body.addressCity,
      addressPostalCode: body.addressPostalCode,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // Audit: log the FACT that firmowe dane do faktury zostały zapisane — bez PII
    // (NIP/nazwa firmy/adres NIE trafiają do event-logu). Schedule before respond.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.ACCOUNT.VAT_INVOICE_DETAILS_SAVED,
        user: { id: session.userId },
        requestBody: { saved: true },
        metadata,
      })
    );

    respondSuccess(res, result.data);
  },
});
