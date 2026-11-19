import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { defineEndpoint } from '@app/http/define-endpoint';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { getEventLogsByUser_IO } from '@app/event-log/event-log.client';
import { respondValidationFailed } from '@app/http/http.responses.utils';
import { isEventLogTypeNarrower } from '@kernel/models/type_narrowing';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { EVENT_LOG_CONTRACTS } from '@kernel/domain/event-log/event-log.contracts';

export default defineEndpoint(EVENT_LOG_CONTRACTS.EVENT_LOG_GET_ALL, {
  handle: async ({ input, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    res.setHeader('Cache-Control', 'no-store');

    const type =
      input.type !== undefined && isEventLogTypeNarrower(input.type)
        ? input.type
        : null;
    if (!type) {
      return respondValidationFailed(res, { type: 'Required' });
    }

    const { records, nextCursor } = await getEventLogsByUser_IO(
      currentUser.id,
      type,
      { cursor: input.cursor, take: input.take },
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

    ok({ records, nextCursor }, APP_EVENTS.INFO.APPLICATION.SUCCESS);
  },
});
