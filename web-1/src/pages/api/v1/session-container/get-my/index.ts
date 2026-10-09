import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import type { SESSION_CONTAINER_DTO_API_V1 } from '@kernel/models/session-container/session-container.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { getMySessionContainers_IO } from '@domain/session-container/operations/session-container.operations';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { qStr, qInt } from '@app/http/query-params.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_GET_MY']['REQUEST'],
  SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_GET_MY']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.SESSION_CONTAINER.SESSION_CONTAINER_GET_MY,
  method: 'get',
  validate: VALIDATION_POLICY.validators.sessionContainerGetMy,
  handle: async (_body, ctx, metadata, res, req) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const cursor = qStr(req.query, 'cursor') ?? undefined;
    const take = qInt(req.query, 'take') ?? 50;

    const result = await getMySessionContainers_IO({
      client_account_id: currentUser.client_account?.client_account_id,
      stylist_account_id: currentUser.stylist_account?.account_id,
      ...(cursor !== undefined && { cursor }),
      take,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINERS_FETCHED,
        user: currentUser,
        metadata,
      })
    );

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINERS_FETCHED
    );
  },
});
