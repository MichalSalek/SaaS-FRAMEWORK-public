import { defineEndpoint } from '@app/http/define-endpoint';
import { ACCOUNT_CONTRACTS } from '@kernel/domain/account/account.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { saveVatInvoiceDetails_IO } from '@app/stripe/vat-invoice.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';

export default defineEndpoint(ACCOUNT_CONTRACTS.ACCOUNT_VAT_INVOICE_DETAILS, {
  handle: async ({ input: body, ctx, meta: metadata, res }) => {
    // userId ZAWSZE z sesji, NIGDY z body.
    const { session } = requireAuthenticatedContext(ctx);
    const result = await saveVatInvoiceDetails_IO({
      userId: session.userId,
      companyName: body.companyName,
      nip: body.nip,
      country: body.country,
      taxId: body.taxId,
      addressState: body.addressState,
      addressLine1: body.addressLine1,
      ...(body.addressLine2 !== undefined && {
        addressLine2: body.addressLine2,
      }),
      addressCity: body.addressCity,
      addressPostalCode: body.addressPostalCode,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // Audit logs that company invoice details were saved, with no PII (tax id,
    // company name and address stay out of the event log). Schedule before respond.
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
