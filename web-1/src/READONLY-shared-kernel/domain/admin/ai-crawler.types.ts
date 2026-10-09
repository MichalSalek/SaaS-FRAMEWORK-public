/**
 * Domain types for AI Crawler Analytics — admin view.
 * Supports two query endpoints:
 *   - ADMIN_AI_CRAWLER_STATS — aggregated stats over the last AI_CRAWLER_STATS_DAYS days
 *   - ADMIN_AI_CRAWLER_LIST — paginated raw event list with filters
 */

import type { AiCrawlerEvent } from '../../models/db_models.generated.dto';
import type { AiCrawlerBotCategory } from '../seo/ai-crawler-detection';

/**
 * Public projection of AiCrawlerEvent for admin UI.
 * Excludes ip_address (PII) — bot identification relies on user_agent + bot_name.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Prisma model `AiCrawlerEvent.bot_category` jest `string | null` (DB schema),
 * ale narrowing do `AiCrawlerBotCategory` w admin DTO jest bezpieczny, bo
 * track-crawler insert ZAWSZE używa `detectAiCrawler(user_agent)` zwracającego
 * `AiCrawlerBotInfo | null` z `bot_category: AiCrawlerBotCategory`. Innymi słowy:
 * `string` na poziomie DB to historical type safety gap, w runtime wszystkie wartości
 * należą do union AiCrawlerBotCategory.
 */
export type AiCrawlerEventPublic = Omit<
  Pick<
    AiCrawlerEvent,
    'id' | 'created_at' | 'user_agent' | 'path' | 'bot_name' | 'country'
  >,
  never
> & {
  bot_category: AiCrawlerBotCategory | null;
};

export interface AiCrawlerStatsResponse {
  total_crawls: number;
  unique_bots: number;
  crawls_by_bot: ReadonlyArray<{
    bot_name: string;
    bot_category: AiCrawlerBotCategory;
    count: number;
  }>;
  crawls_by_day: ReadonlyArray<{
    date: string; // YYYY-MM-DD
    count: number;
    top_bot: string | null;
  }>;
  crawls_by_path: ReadonlyArray<{
    path: string;
    count: number;
  }>;
  crawls_by_category: ReadonlyArray<{
    bot_category: AiCrawlerBotCategory;
    count: number;
  }>;
  recent_crawls: ReadonlyArray<AiCrawlerEventPublic>;
}

export interface AiCrawlerListQuery {
  page: number;
  page_size: number;
  bot_category?: AiCrawlerBotCategory | null;
  bot_name?: string | null;
  path?: string | null;
  from_date?: string | null; // ISO 8601
  to_date?: string | null;
}

export interface AiCrawlerListResponse {
  items: ReadonlyArray<AiCrawlerEventPublic>;
  total: number;
  page: number;
  page_size: number;
}

export const AI_CRAWLER_DEFAULT_PAGE_SIZE = 50;
export const AI_CRAWLER_MAX_PAGE_SIZE = 200;
export const AI_CRAWLER_STATS_DAYS = 30; // days included in stats aggregation
