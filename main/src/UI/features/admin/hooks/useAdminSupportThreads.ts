// main/src/UI/features/admin/hooks/useAdminSupportThreads.ts
// TQ v5 useInfiniteQuery — cursor-based pagination for admin support threads
// GET /api/v1/admin/support/threads (filterable by status)

import { useInfiniteQuery } from '@tanstack/react-query';
import type { InfiniteData, QueryKey } from '@tanstack/react-query';
import { adminGetSupportThreads_IO } from '../../../../domain/support/supportIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type {
  SupportThreadStatus,
  SupportThreadAdminListItem,
  SUPPORT_DTO_API_V1,
} from '@kernel/models/support/support.dto';

export type { SupportThreadAdminListItem, SupportThreadStatus };

/* ─── Types ─── */

type AdminThreadsResponse =
  SUPPORT_DTO_API_V1['SUPPORT_ADMIN_GET_ALL_THREADS']['RESPONSE'];

/* ─── Flatten helper ─── */

function flattenAdminThreadPages(
  data: InfiniteData<AdminThreadsResponse> | undefined
): SupportThreadAdminListItem[] {
  return data?.pages.flatMap(p => p.threads) ?? [];
}

/* ─── Hook ─── */

export type AdminSupportThreadsFilter = {
  status?: SupportThreadStatus;
  /**
   * true = exactly the threads counted by the menu badge
   * `support_awaiting_reply`; the server ignores `status` then.
   */
  awaitingReply?: boolean;
};

export function useAdminSupportThreads(
  { status, awaitingReply = false }: AdminSupportThreadsFilter,
  enabled = true
) {
  const query = useInfiniteQuery<
    AdminThreadsResponse,
    Error,
    InfiniteData<AdminThreadsResponse>,
    QueryKey,
    string | undefined
  >({
    // The awaiting list is its own cache entry under the same prefix, so
    // `adminThreadsAll` invalidation (reply, status change) refreshes it too.
    queryKey: queryKeys.support.adminThreads(
      awaitingReply ? 'awaiting-reply' : status
    ),
    queryFn: ({ pageParam, signal }) => {
      const req: SUPPORT_DTO_API_V1['SUPPORT_ADMIN_GET_ALL_THREADS']['REQUEST'] =
        {
          ...(awaitingReply
            ? { awaiting_reply: true }
            : status !== undefined && { status }),
          take: 20,
          ...(pageParam != null && { cursor: pageParam }),
        };
      return adminGetSupportThreads_IO(req, { signal });
    },
    getNextPageParam: lastPage => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined,
    staleTime: 30_000,
    enabled,
  });

  return {
    threads: flattenAdminThreadPages(query.data),
    /** True once at least one page resolved — a later failure keeps these rows. */
    hasData: query.data !== undefined,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    isFetchNextPageError: query.isFetchNextPageError,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch,
  } as const;
}
