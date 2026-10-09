import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { reportIssueBackend } from '@app/debugger/error-handler';
import {
  respondSuccess,
  respondValidationFailed,
} from '@app/http/http.responses.utils';
import { getPublicStylistProfile_IO } from '@domain/account/operations/account-profile.operations';
import type { ACCOUNT_DTO_API_V1 } from '@kernel/models/account/account.dto';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { qStr } from '@app/http/query-params.utils';
export default defineHandler<
  ACCOUNT_DTO_API_V1['ACCOUNT_GET_PUBLIC_PROFILE']['REQUEST'],
  ACCOUNT_DTO_API_V1['ACCOUNT_GET_PUBLIC_PROFILE']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.ACCOUNT.ACCOUNT_GET_PUBLIC_PROFILE,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, _ctx, _metadata, res, req) => {
    res.setHeader(
      'Cache-Control',
      'public, max-age=60, stale-while-revalidate=300'
    );

    const identifier = qStr(req.query, 'identifier');
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
