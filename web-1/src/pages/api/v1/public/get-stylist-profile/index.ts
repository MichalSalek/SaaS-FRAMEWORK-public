import { defineEndpoint } from '@app/http/define-endpoint';
import { ACCOUNT_CONTRACTS } from '@kernel/domain/account/account.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { reportIssueBackend } from '@app/debugger/error-handler';
import {
  respondSuccess,
  respondValidationFailed,
} from '@app/http/http.responses.utils';
import { getPublicStylistProfile_IO } from '@domain/account/operations/account-profile.operations';
import { mapErrorToResponse } from '@app/http/error-mapper';
export default defineEndpoint(ACCOUNT_CONTRACTS.ACCOUNT_GET_PUBLIC_PROFILE, {
  handle: async ({ input, res }) => {
    res.setHeader(
      'Cache-Control',
      'public, max-age=60, stale-while-revalidate=300'
    );

    const identifier = input.identifier;
    if (!identifier) {
      return respondValidationFailed(res, { identifier: 'Required' });
    }

    const result = await getPublicStylistProfile_IO({ identifier });

    if (!result.success) {
      reportIssueBackend({
        namespace: 'ACCOUNT_GET_PUBLIC_PROFILE',
        message: 'Account not found',
        payload: { identifier },
        mode: 'info',
      });
      return mapErrorToResponse(res, result.error);
    }

    const responsePayload = result.data;

    reportIssueBackend({
      namespace: 'ACCOUNT_GET_PUBLIC_PROFILE',
      message: 'Public profile fetched successfully',
      payload: {
        identifier,
        account_id: responsePayload.account.account_id,
        gallery_count: responsePayload.gallery_records_count,
      },
      mode: 'info',
    });

    respondSuccess(
      res,
      responsePayload,
      APP_EVENTS.INFO.ACCOUNT.PUBLIC_PROFILE_FETCHED
    );
  },
});
