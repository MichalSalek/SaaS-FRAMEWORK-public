// UI/features/support/hooks/useSupportThreads.ts
// TQ v5 useInfiniteQuery — cursor-based pagination for /api/v1/support/get-my-threads
// Fetches all support threads for the current user.

import { useInfiniteQuery } from '@tanstack/react-query';
import type { InfiniteData, QueryKey } from '@tanstack/react-query';
import { getSupportThreads_IO } from '../../../../domain/support/supportIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { SUPPORT_DTO_API_V1 } from '@kernel/models/support/support.dto';

/* --- Types --- */

type ThreadsResponse = SUPPORT_DTO_API_V1['SUPPORT_GET_MY_THREADS']['RESPONSE'];

/* --- Flatten helper --- */

export function flattenThreadPages(
  data: InfiniteData<ThreadsResponse> | undefined
): ThreadsResponse['threads'] {
  return data?.pages.flatMap(p => p.threads) ?? [];
}

/* --- Hook --- */

export function useSupportThreads() {
  return useInfiniteQuery<
    ThreadsResponse,
    Error,
    InfiniteData<ThreadsResponse>,
    QueryKey,
    string | undefined
  >({
    queryKey: queryKeys.support.threads,
    queryFn: ({ pageParam, signal }) => {
      const req: SUPPORT_DTO_API_V1['SUPPORT_GET_MY_THREADS']['REQUEST'] =
        pageParam != null ? { cursor: pageParam, take: 20 } : { take: 20 };
      return getSupportThreads_IO(req, { signal });
    },
    getNextPageParam: lastPage => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined,
    staleTime: 30_000,
  });
}
