// UI/features/admin/hooks/useAdminAttentionCounts.ts
// TQ hook for the admin "needs a reaction" counters: menu badges, the bottom
// tabs and the dashboard panel all read this one query (SSOT of the numbers;
// which screen each number opens lives in admin-attention.config.ts).
// Uses the queryOptions() pattern (TQ v5 SSOT).

import { queryOptions, useQuery } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { adminGetAttentionCounts_IO } from '../../../../domain/admin/attention/adminAttentionIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';

const adminAttentionQueryOptions = queryOptions({
  queryKey: queryKeys.admin.attention,
  queryFn: ({ signal }) => adminGetAttentionCounts_IO(undefined, { signal }),
  // The badge must be "live" without a manual refresh: the admin sits in the panel and a new support
  // thread should appear by itself. A 60s interval = no real load (light aggregate queries on the API).
  staleTime: 30_000,
  refetchInterval: 60_000,
});

/**
 * Call in `onSuccess` of every mutation that moves a counted item out of (or
 * into) its queue: log issue status, support reply and status, moderation
 * resolve and strike.
 *
 * DECISION: invalidate the attention counts right after an admin action. Without it the badge kept
 * the old number for up to a minute after the item was handled, so the menu said "Logi 3" above a
 * list of two. A count and its list must move together.
 */
export const invalidateAdminAttention = (queryClient: QueryClient): void => {
  void queryClient.invalidateQueries({ queryKey: queryKeys.admin.attention });
};

// `enabled` — gate on the confirmed admin role (useAppRole().isAdmin), so the session hydration
// window does not fire a query that ends in 403.
export function useAdminAttentionCounts(enabled: boolean) {
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    ...adminAttentionQueryOptions,
    enabled,
  });

  return {
    counts: data ?? null,
    isLoading,
    isError,
    isFetching,
    refetch,
  };
}
