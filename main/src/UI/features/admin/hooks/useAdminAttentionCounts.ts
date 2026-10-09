// UI/features/admin/hooks/useAdminAttentionCounts.ts
// TQ hook for the admin "needs a reaction" counters: menu badges, the bottom
// tabs and the dashboard panel all read this one query (SSOT of the numbers;
// which screen each number opens lives in admin-attention.config.ts).
// Uses queryOptions() pattern (TQ v5 SSOT — MIG-B1).

import { queryOptions, useQuery } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { adminGetAttentionCounts_IO } from '../../../../domain/admin/attention/adminAttentionIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';

const adminAttentionQueryOptions = queryOptions({
  queryKey: queryKeys.admin.attention,
  queryFn: ({ signal }) => adminGetAttentionCounts_IO(undefined, { signal }),
  // Badge ma być "żywy" bez ręcznego odświeżania — admin siedzi w panelu,
  // a nowy wątek supportu ma się pojawić sam. Interwał 60s = zero realnego
  // obciążenia (lekkie zapytania agregujące po stronie API).
  staleTime: 30_000,
  refetchInterval: 60_000,
});

/**
 * Call in `onSuccess` of every mutation that moves a counted item out of (or
 * into) its queue: log issue status, support reply and status, moderation
 * resolve and strike.
 *
 * DECISION (nie usuwaj tego komentarza) — S126: without this the badge kept
 * the old number for up to a minute after the admin handled the item, so the
 * menu said „Logi 3” above a list of two. A count and its list must move
 * together.
 */
export const invalidateAdminAttention = (queryClient: QueryClient): void => {
  void queryClient.invalidateQueries({ queryKey: queryKeys.admin.attention });
};

// `enabled` — gate na potwierdzoną rolę admina (useAppRole().isAdmin), żeby
// okno hydratacji sesji nie strzelało zapytaniem kończącym się 403.
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
