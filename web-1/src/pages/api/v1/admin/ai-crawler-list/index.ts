import { defineEndpoint } from '@app/http/define-endpoint';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminGetAiCrawlerList_IO } from '@domain/admin/operations/ai-crawler-list.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';

export default defineEndpoint(ADMIN_CONTRACTS.ADMIN_AI_CRAWLER_LIST, {
  handle: async ({ input, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    res.setHeader('Cache-Control', 'no-store');

    const result = await adminGetAiCrawlerList_IO({
      currentUser,
      query: {
        page: input.page,
        page_size: input.page_size,
        bot_category: input.bot_category ?? null,
        bot_name: input.bot_name ?? null,
        path: input.path ?? null,
        from_date: input.from_date ?? null,
        to_date: input.to_date ?? null,
      },
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    ok(
      { ...result.data, items: [...result.data.items] },
      APP_EVENTS.INFO.ADMIN.ADMIN_AI_CRAWLER_LIST_RETURNED
    );
  },
});
