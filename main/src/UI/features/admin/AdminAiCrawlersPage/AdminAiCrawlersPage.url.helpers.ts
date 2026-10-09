// UI/features/admin/AdminAiCrawlersPage/AdminAiCrawlersPage.url.helpers.ts
// Pure URL <-> list-params mapping for the crawlers page (query parsing with
// backend-cap clamps, clean-URL serialisation). Extracted from the composition
// (max-lines 300); no React here.

import type { AiCrawlerListRequest } from '../hooks/useAiCrawlerList';
import {
  AI_CRAWLER_DEFAULT_PAGE_SIZE,
  AI_CRAWLER_MAX_PAGE_SIZE,
} from '@kernel/domain/admin/ai-crawler.types';

const queryParamToString = (
  raw: string | string[] | undefined
): string | null => {
  if (raw === undefined) {
    return null;
  }
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value.length === 0) {
    return null;
  }
  return value;
};

const queryParamToInt = (
  raw: string | string[] | undefined,
  fallback: number
): number => {
  const str = queryParamToString(raw);
  if (str === null) {
    return fallback;
  }
  const num = Number(str);
  return Number.isFinite(num) && num >= 1 ? num : fallback;
};

export const parseUrlParams = (
  query: Record<string, string | string[] | undefined>
): AiCrawlerListRequest => ({
  page: queryParamToInt(query['page'], 1),
  // Clamp do backendowego capa: URL z page_size=999 wykonywał się jako 200,
  // a UI liczyło strony z 999 (pusta dalsza paginacja).
  page_size: Math.min(
    queryParamToInt(query['page_size'], AI_CRAWLER_DEFAULT_PAGE_SIZE),
    AI_CRAWLER_MAX_PAGE_SIZE
  ),
  bot_category: queryParamToString(query['bot_category']),
  bot_name: queryParamToString(query['bot_name']),
  path: queryParamToString(query['path']),
  from_date: queryParamToString(query['from_date']),
  to_date: queryParamToString(query['to_date']),
});

export const FILTER_QUERY_KEYS = [
  'page',
  'page_size',
  'bot_category',
  'bot_name',
  'path',
  'from_date',
  'to_date',
] as const;

export const buildUrlQuery = (
  params: AiCrawlerListRequest,
  currentQuery: Record<string, string | string[] | undefined>
): Record<string, string> => {
  // Preserve unrelated query params (e.g. router-injected locale), only update our keys.
  const next: Record<string, string> = {};
  Object.entries(currentQuery).forEach(([key, value]) => {
    if ((FILTER_QUERY_KEYS as ReadonlyArray<string>).includes(key)) {
      return;
    }
    if (typeof value === 'string' && value.length > 0) {
      next[key] = value;
    }
  });
  if (params.page > 1) {
    next['page'] = String(params.page);
  }
  if (params.page_size !== AI_CRAWLER_DEFAULT_PAGE_SIZE) {
    next['page_size'] = String(params.page_size);
  }
  if (params.bot_category) {
    next['bot_category'] = params.bot_category;
  }
  if (params.bot_name) {
    next['bot_name'] = params.bot_name;
  }
  if (params.path) {
    next['path'] = params.path;
  }
  if (params.from_date) {
    next['from_date'] = params.from_date;
  }
  if (params.to_date) {
    next['to_date'] = params.to_date;
  }
  return next;
};
