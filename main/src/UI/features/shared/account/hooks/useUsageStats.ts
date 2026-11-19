import { useQuery, queryOptions } from '@tanstack/react-query';
import { getUserUsageStats_IO } from '../../../../../domain/user/userIO.possibilities.api';
import { queryKeys } from '../../../../../application/http/queryKeys.factory';

/* ─── Query options (exported for potential prefetch/invalidation) ─── */

export const usageStatsQueryOptions = queryOptions({
  queryKey: queryKeys.account.usageStats,
  queryFn: ({ signal }) => getUserUsageStats_IO({}, { signal }),
  staleTime: 60_000,
});

/* ─── Hook ─── */

export function useUsageStats() {
  return useQuery(usageStatsQueryOptions);
}
