// UI/features/admin/hooks/useAiCrawlerStats.ts
// TQ hook for AI crawler dashboard stats — aggregated over last 30 days.
// Uses queryOptions() pattern (TQ v5 SSOT).

import { queryOptions, useQuery } from '@tanstack/react-query';
import { adminGetAiCrawlerStats_IO } from '../../../../domain/admin/logs/adminLogsIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { shouldRetryAdminQuery } from './admin-retry-policy';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

export type AiCrawlerStatsResponse =
  ADMIN_DTO_API_V1['ADMIN_AI_CRAWLER_STATS']['RESPONSE'];

/* ─── Fetcher ─── */

const fetchAiCrawlerStats = adminGetAiCrawlerStats_IO;

/* ─── Query options ─── */

const aiCrawlerStatsQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.admin.aiCrawlerStats,
    queryFn: ({ signal }) => fetchAiCrawlerStats(undefined, { signal }),
    // 5 min staleTime: the stats endpoint aggregates 30 days through 7 queries (count + 5x groupBy
    // + raw SQL) and the bots deliver data hours late, so a faster refetch is overkill.
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    retry: shouldRetryAdminQuery,
  });

/* ─── Hook ─── */

export function useAiCrawlerStats() {
  const { data, isLoading, isError, isFetching, refetch } = useQuery(
    aiCrawlerStatsQueryOptions()
  );

  return {
    stats: data ?? null,
    isLoading,
    isError,
    isFetching,
    refetch,
  };
}
