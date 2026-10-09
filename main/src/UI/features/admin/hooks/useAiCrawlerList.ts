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
// DECISION (nie usuwaj tego komentarza):
// `bot_category` zostaje `string | null` na poziomie UI — wartości pochodzą z
// `<select>` (free-form e.target.value) i casowane są przy fetcherze na
// `AiCrawlerBotCategory | null`. Sanitize w backendzie (`sanitizeQuery`) walidauje
// finalnie. Cast safe — backend nie używa kategorii do query (only LIKE filter).
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

const toWireRequest = (
  params: AiCrawlerListRequest
): AiCrawlerListWireRequest => {
  const { bot_category, ...rest } = params;
  return {
    ...rest,
    ...(bot_category !== undefined && {
      bot_category: bot_category as AiCrawlerBotCategory | null,
    }),
  };
};

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
