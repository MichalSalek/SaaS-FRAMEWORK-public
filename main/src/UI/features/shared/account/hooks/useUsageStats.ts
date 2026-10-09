// UI/features/shared/account/hooks/useUsageStats.ts
// Fetches the current user's usage stats (galleries, pairings, sessions, limits).
// GET /api/v1/user/usage-stats — requires LOGGED_USER permission.
// Stack: TQ v5 queryOptions + unified io.ts front-door (promise-first).

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
