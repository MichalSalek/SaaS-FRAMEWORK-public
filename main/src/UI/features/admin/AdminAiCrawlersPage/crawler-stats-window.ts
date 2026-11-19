// Pure helpers that tie the statistics (a rolling window of the last
// AI_CRAWLER_STATS_DAYS days) to the raw event list (filtered by day).

import { TIME } from '@kernel/application/constants.config';
import { AI_CRAWLER_STATS_DAYS } from '@kernel/domain/admin/ai-crawler.types';
import type { AiCrawlerListRequest } from '../hooks/useAiCrawlerList';

/** First day of the statistics window, as the list's `from_date` (YYYY-MM-DD, UTC). */
export function statsWindowStart(now: Date): string {
  return new Date(now.getTime() - AI_CRAWLER_STATS_DAYS * TIME.MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

const FILTER_KEYS = [
  'bot_category',
  'bot_name',
  'path',
  'from_date',
  'to_date',
] as const satisfies ReadonlyArray<keyof AiCrawlerListRequest>;

export type CrawlerFilterKey = (typeof FILTER_KEYS)[number];

/** How many list filters are set (page and page size are not filters). */
export function countCrawlerFilters(params: AiCrawlerListRequest): number {
  return FILTER_KEYS.filter(key => Boolean(params[key])).length;
}

/**
 * The list narrowed to what one statistic counts: the statistics window plus
 * the one dimension of that statistic. Other filters are dropped, so the list
 * shows the counted events and nothing narrower.
 */
export function crawlerDoorParams(
  current: AiCrawlerListRequest,
  now: Date,
  dimension: Partial<
    Pick<AiCrawlerListRequest, 'bot_category' | 'bot_name' | 'path'>
  >
): AiCrawlerListRequest {
  return {
    page: 1,
    page_size: current.page_size,
    from_date: statsWindowStart(now),
    ...dimension,
  };
}

/** The list currently shows exactly that door (same window, same dimension). */
export function isCrawlerDoorOpen(
  current: AiCrawlerListRequest,
  now: Date,
  dimension: Partial<
    Pick<AiCrawlerListRequest, 'bot_category' | 'bot_name' | 'path'>
  >
): boolean {
  const door = crawlerDoorParams(current, now, dimension);
  return FILTER_KEYS.every(
    key => (current[key] ?? null) === (door[key] ?? null)
  );
}
