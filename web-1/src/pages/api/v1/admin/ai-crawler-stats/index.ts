import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { adminGetAiCrawlerStats_IO } from '@domain/admin/operations/ai-crawler-stats.operations';
export default defineHandler({
  eventName: APP_EVENTS.QUERIES.ADMIN.ADMIN_AI_CRAWLER_STATS,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    res.setHeader('Cache-Control', 'no-store');

    const result = await adminGetAiCrawlerStats_IO({ currentUser });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.ADMIN.ADMIN_AI_CRAWLER_STATS_RETURNED
    );
  },
});
