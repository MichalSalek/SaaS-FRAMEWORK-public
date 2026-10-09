// UI/features/shared/dashboard/hooks/useDashboardFeed.ts
// TQ v5 query -- GET /api/v1/account/get-dashboard-feed
// Fetches per-role dashboard feed (stats, gallery strength, recent records).
// Stack: TanStack Query v5.

import { queryOptions, useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../../../../application/http/queryKeys.factory';
import { getDashboardFeed_IO } from '../../../../../domain/account/accountIO.possibilities.api';

/* --- Query options (reusable) --- */

const dashboardFeedQueryOptions = queryOptions({
  queryKey: queryKeys.account.dashboardFeed,
  queryFn: ({ signal }) => getDashboardFeed_IO(undefined, { signal }),
  staleTime: 60_000,
});

/* --- Hook --- */

export function useDashboardFeed(enabled = true) {
  const { data, isLoading, isError, refetch } = useQuery({
    ...dashboardFeedQueryOptions,
    enabled,
  });

  return {
    feed: data ?? null,
    isLoading,
    isError,
    refetch,
  };
}
