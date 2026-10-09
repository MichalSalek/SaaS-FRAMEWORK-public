import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { getEventLogsByUser_IO } from '@app/event-log/event-log.client';
import {
  respondSuccess,
  respondValidationFailed,
} from '@app/http/http.responses.utils';
import type { EVENT_LOG_DTO_API_V1 } from '@kernel/models/event-log/event_log.dto';
import { qStr, qInt } from '@app/http/query-params.utils';
import { isEventLogTypeNarrower } from '@kernel/models/type_narrowing';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  EVENT_LOG_DTO_API_V1['EVENT_LOG_GET_ALL']['REQUEST'],
  EVENT_LOG_DTO_API_V1['EVENT_LOG_GET_ALL']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.EVENT_LOG.EVENT_LOG_GET_ALL,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res, req) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    res.setHeader('Cache-Control', 'no-store');

    const rawType = qStr(req.query, 'type');
    const type = rawType && isEventLogTypeNarrower(rawType) ? rawType : null;
    if (!type) {
      return respondValidationFailed(res, { type: 'Required' });
    }

    const cursor = qStr(req.query, 'cursor') ?? undefined;
    const take = qInt(req.query, 'take') ?? 50;

    // Endpoint jest WYŁĄCZNIE user-side (ekran „Aktywność") → whitelist
    // USER_FACING_ACTIVITY_EVENTS na stałe; pełny audit trail zostaje w DB
    // i jest dostępny kanałami admina.
    const { records, nextCursor } = await getEventLogsByUser_IO(
      currentUser.id,
      type,
      { cursor, take },
      { userFacingOnly: true }
    );

    reportIssueBackend({
      namespace: 'EVENT_LOG_GET_ALL',
      message: 'Event logs fetched successfully',
      payload: {
        id: currentUser.id,
        log_count: records.length,
        log_type: type,
        has_more: nextCursor !== null,
      },
      mode: 'info',
    });

    respondSuccess(
      res,
      { records, nextCursor },
      APP_EVENTS.INFO.APPLICATION.SUCCESS
    );
  },
});
