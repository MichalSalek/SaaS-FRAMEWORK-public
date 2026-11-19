import { defineEndpoint } from '@app/http/define-endpoint';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { adminGetAiCrawlerStats_IO } from '@domain/admin/operations/ai-crawler-stats.operations';
export default defineEndpoint(ADMIN_CONTRACTS.ADMIN_AI_CRAWLER_STATS, {
  handle: async ({ ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    res.setHeader('Cache-Control', 'no-store');

    const result = await adminGetAiCrawlerStats_IO({ currentUser });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    ok(
      {
        ...result.data,
        crawls_by_bot: [...result.data.crawls_by_bot],
        crawls_by_day: [...result.data.crawls_by_day],
        crawls_by_path: [...result.data.crawls_by_path],
        crawls_by_category: [...result.data.crawls_by_category],
        recent_crawls: [...result.data.recent_crawls],
      },
      APP_EVENTS.INFO.ADMIN.ADMIN_AI_CRAWLER_STATS_RETURNED
    );
  },
});
