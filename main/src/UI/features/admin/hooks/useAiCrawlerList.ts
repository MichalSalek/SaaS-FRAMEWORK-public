// UI/features/admin/hooks/useAiCrawlerList.ts
// TQ hook for paginated AI crawler events list with filters.
// Uses queryOptions() pattern (TQ v5 SSOT).

import { queryOptions, useQuery } from '@tanstack/react-query';
import { adminGetAiCrawlerList_IO } from '../../../../domain/admin/logs/adminLogsIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { shouldRetryAdminQuery } from './admin-retry-policy';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import type { AiCrawlerBotCategory } from '@kernel/domain/seo/ai-crawler-detection';

// Wire type from kernel — page/page_size optional on backend (defaulted server-side).
type AiCrawlerListWireRequest =
  ADMIN_DTO_API_V1['ADMIN_AI_CRAWLER_LIST']['REQUEST'];

// UI-side type — page + page_size are always set by the page state; filters optional.
// DECISION: bot_category stays `string | null` at the UI level: values come from a free-form
// <select> and are cast to AiCrawlerBotCategory | null in the fetcher; the backend sanitizeQuery
// validates finally. The cast is safe, the backend uses the category only as a LIKE filter.
export type AiCrawlerListRequest = {
  page: number;
  page_size: number;
  bot_category?: string | null;
  bot_name?: string | null;
  path?: string | null;
  from_date?: string | null;
  to_date?: string | null;
};

export type AiCrawlerListResponse =
  ADMIN_DTO_API_V1['ADMIN_AI_CRAWLER_LIST']['RESPONSE'];

/* ─── Fetcher ─── */

const fetchAiCrawlerList = adminGetAiCrawlerList_IO;

const definedString = <T extends string>(
  value: T | null | undefined
): value is T => value !== null && value !== undefined;

const toWireRequest = (
  params: AiCrawlerListRequest
): AiCrawlerListWireRequest => ({
  page: params.page,
  page_size: params.page_size,
  ...(definedString(params.bot_category) && {
    bot_category: params.bot_category as AiCrawlerBotCategory,
  }),
  ...(definedString(params.bot_name) && { bot_name: params.bot_name }),
  ...(definedString(params.path) && { path: params.path }),
  ...(definedString(params.from_date) && { from_date: params.from_date }),
  ...(definedString(params.to_date) && { to_date: params.to_date }),
});

/* ─── Query options ─── */

const aiCrawlerListQueryOptions = (params: AiCrawlerListRequest) => {
  const wire = toWireRequest(params);
  return queryOptions({
    queryKey: queryKeys.admin.aiCrawlerList(wire),
    queryFn: ({ signal }) => fetchAiCrawlerList(wire, { signal }),
    staleTime: 30_000,
    placeholderData: prev => prev,
    retry: shouldRetryAdminQuery,
  });
};

/* ─── Hook ─── */

export function useAiCrawlerList(params: AiCrawlerListRequest) {
  const { data, isLoading, isError, isFetching, refetch } = useQuery(
    aiCrawlerListQueryOptions(params)
  );

  return {
    data: data ?? null,
    isLoading,
    isError,
    isFetching,
    refetch,
  };
}
