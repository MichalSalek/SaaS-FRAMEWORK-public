import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminGetAiCrawlerList_IO } from '@domain/admin/operations/ai-crawler-list.operations';
import { qStr, qInt } from '@app/http/query-params.utils';
import type { AiCrawlerListQuery } from '@kernel/domain/admin/ai-crawler.types';
import type { AiCrawlerBotCategory } from '@kernel/domain/seo/ai-crawler-detection';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler({
  eventName: APP_EVENTS.QUERIES.ADMIN.ADMIN_AI_CRAWLER_LIST,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res, req) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    res.setHeader('Cache-Control', 'no-store');

    const pageParam = qInt(req.query, 'page');
    const pageSizeParam = qInt(req.query, 'page_size');
    // DECISION (nie usuwaj tego komentarza):
    // `bot_category` z query string jest typowany jako `string | null` przez qStr.
    // Cast do `AiCrawlerBotCategory | null` jest bezpieczny — sanitizeQuery w
    // operations stosuje `isAiCrawlerBotCategoryNarrower` i zwraca null dla
    // nieprawidłowych wartości (traktując je jako "brak filtra"). Cast jest
    // potrzebny tylko na poziomie typów; runtime narrowing dzieje się w sanitizeQuery.
    const query: Partial<AiCrawlerListQuery> = {
      ...(pageParam !== null && { page: pageParam }),
      ...(pageSizeParam !== null && { page_size: pageSizeParam }),
      bot_category: qStr(
        req.query,
        'bot_category'
      ) as AiCrawlerBotCategory | null,
      bot_name: qStr(req.query, 'bot_name'),
      path: qStr(req.query, 'path'),
      from_date: qStr(req.query, 'from_date'),
      to_date: qStr(req.query, 'to_date'),
    };

    const result = await adminGetAiCrawlerList_IO({ currentUser, query });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.ADMIN.ADMIN_AI_CRAWLER_LIST_RETURNED
    );
  },
});
