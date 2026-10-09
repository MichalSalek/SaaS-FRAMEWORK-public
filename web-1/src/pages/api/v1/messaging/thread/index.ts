import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { getThread_IO } from '@domain/messaging/operations/messaging-query.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import type { MESSAGING_DTO_API_V1 } from '@kernel/models/messaging/messaging.dto';
import { qStr } from '@app/http/query-params.utils';

export default defineHandler<
  MESSAGING_DTO_API_V1['MESSAGING_GET_THREAD']['REQUEST'],
  MESSAGING_DTO_API_V1['MESSAGING_GET_THREAD']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.MESSAGING.MESSAGING_GET_THREAD,
  method: 'get',
  // GET: parametry są w query-stringu, NIE w body → walidacja no-op (parytet
  // conversations/support-thread-messages). pair_id jest gejtowany downstream:
  // qStr (pusty → '') + resolvePairSide (pusty/obcy pair_id → findUnique null →
  // MESSAGING_PAIR_NOT_FOUND). Realny walidator na body (który dla GET jest {})
  // dawał 400 na KAŻDY request — wątek martwy (closing-review HIGH).
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res, req) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    res.setHeader('Cache-Control', 'no-store');

    const pairId = qStr(req.query, 'pair_id') ?? '';
    const cursor = qStr(req.query, 'cursor') ?? undefined;

    const result = await getThread_IO({
      currentUser,
      pairId,
      ...(cursor !== undefined ? { cursor } : {}),
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.MESSAGING.MESSAGING_THREAD_FETCHED
    );
  },
});
