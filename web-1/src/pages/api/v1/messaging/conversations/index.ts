import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { getConversations_IO } from '@domain/messaging/operations/messaging-query.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import type { MESSAGING_DTO_API_V1 } from '@kernel/models/messaging/messaging.dto';
import { qBool, qStr } from '@app/http/query-params.utils';

export default defineHandler<
  MESSAGING_DTO_API_V1['MESSAGING_GET_CONVERSATIONS']['REQUEST'],
  MESSAGING_DTO_API_V1['MESSAGING_GET_CONVERSATIONS']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.MESSAGING.MESSAGING_GET_CONVERSATIONS,
  method: 'get',
  // Tylko opcjonalne cursor (string) + hidden (bool, D2 „Pokaż ukryte") →
  // walidacja no-op (GET, poza bramką validation-coverage dla write-metod).
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res, req) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    res.setHeader('Cache-Control', 'no-store');

    const cursor = qStr(req.query, 'cursor') ?? undefined;
    // qBool czyta 'true'/'false' (nigdy '1'); brak parametru = lista domyślna.
    const hidden = qBool(req.query, 'hidden') === true;

    const result = await getConversations_IO({
      currentUser,
      ...(cursor !== undefined ? { cursor } : {}),
      hidden,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.MESSAGING.MESSAGING_CONVERSATIONS_FETCHED
    );
  },
});
