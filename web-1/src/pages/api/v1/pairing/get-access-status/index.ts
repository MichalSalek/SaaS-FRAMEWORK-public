import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondValidationFailed } from '@app/http/http.responses.utils';
import { getAccessStatus_IO } from '@domain/pairing/operations/pairing-access.operations';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { PAIRING_CONTRACTS } from '@kernel/domain/pairing/pairing.contracts';

// DECISION: a missing stylist_account_id stays `{ stylist_account_id: 'Required' }`.
// The kernel body schema for this field is not the route parser; wiring it would swap
// that literal for an i18n token. Test: pairing-contract.test.ts (missing, empty and
// a repeated key are 400 and do not call the operation).
export default defineEndpoint(PAIRING_CONTRACTS.PAIRING_GET_ACCESS_STATUS, {
  handle: async ({ input, ctx, res, ok }) => {
    res.setHeader('Cache-Control', 'no-store');

    const stylist_account_id = input.stylist_account_id;
    if (stylist_account_id === undefined) {
      respondValidationFailed(res, { stylist_account_id: 'Required' });
      return;
    }

    const result = await getAccessStatus_IO({
      ...(ctx.currentUser?.id !== undefined && {
        client_user_id: ctx.currentUser.id,
      }),
      stylist_account_id,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    const data = result.data;
    const payload =
      data.access === 'PAIRED'
        ? {
            access: 'PAIRED' as const,
            paired_at: data.paired_at.toISOString(),
            pair_id: data.pair_id,
          }
        : data.access === 'PENDING'
          ? { access: 'PENDING' as const, pair_id: data.pair_id }
          : { access: 'PUBLIC' as const };

    ok(payload, APP_EVENTS.INFO.PAIRING.PAIRING_ACCESS_STATUS_FETCHED);
  },
});
