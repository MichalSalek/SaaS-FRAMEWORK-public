import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { getSupportThreads_IO } from '@domain/support/operations/support-thread-queries.operations';
import type { SUPPORT_DTO_API_V1 } from '@kernel/models/support/support.dto';
import { qStr, qInt } from '@app/http/query-params.utils';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  SUPPORT_DTO_API_V1['SUPPORT_GET_MY_THREADS']['REQUEST'],
  SUPPORT_DTO_API_V1['SUPPORT_GET_MY_THREADS']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.SUPPORT.SUPPORT_GET_MY_THREADS,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res, req) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const cursor = qStr(req.query, 'cursor') ?? undefined;
    const take = qInt(req.query, 'take') ?? 20; // default 20 — zgodny z frontendowym useSupportThreads (take:20)

    const result = await getSupportThreads_IO(currentUser.id, {
      cursor,
      take,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.SUPPORT.SUPPORT_THREADS_FETCHED
    );
  },
});
