import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import {
  respondSuccess,
  respondValidationFailed,
} from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import type { SESSION_CONTAINER_DTO_API_V1 } from '@kernel/models/session-container/session-container.dto';
import { getSessionContainerById_IO } from '@domain/session-container/operations/session-container.operations';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { qStr } from '@app/http/query-params.utils';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_GET_BY_ID']['REQUEST'],
  SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_GET_BY_ID']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.SESSION_CONTAINER.SESSION_CONTAINER_GET_BY_ID,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, metadata, res, req) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    res.setHeader('Cache-Control', 'no-store');

    const session_id = qStr(req.query, 'session_id');
    if (!session_id) {
      return respondValidationFailed(res, { session_id: 'Required' });
    }

    const result = await getSessionContainerById_IO({
      session_id,
      client_account_id: currentUser.client_account?.client_account_id,
      stylist_account_id: currentUser.stylist_account?.account_id,
      user_id: currentUser.id,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_FETCHED,
        user: currentUser,
        requestBody: { session_id },
        metadata,
      })
    );

    respondSuccess(
      res,
      { session: result.data },
      APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_FETCHED
    );
  },
});
