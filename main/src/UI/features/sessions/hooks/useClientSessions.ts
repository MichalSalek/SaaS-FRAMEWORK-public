// UI/features/sessions/hooks/useClientSessions.ts
// TQ v5 useInfiniteQuery — cursor-based pagination for /api/v1/session-container/get-my
// Fetches all session containers for the current user (client).
// Stack: TanStack Query v5.

import { useInfiniteQuery } from '@tanstack/react-query';
import type { InfiniteData, QueryKey } from '@tanstack/react-query';
import { getMySessionContainers_IO } from '../../../../domain/session-container/sessionContainerIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { SESSION_CONTAINER_DTO_API_V1 } from '@kernel/models/session-container/session-container.dto';
import type { SessionContainerDTO } from '@kernel/models/session-container/session-container.dto';

/* --- Types --- */

type SessionsResponse =
  SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_GET_MY']['RESPONSE'];

/* --- Flatten helper --- */

export function flattenClientSessionPages(
  data: InfiniteData<SessionsResponse> | undefined
): SessionContainerDTO[] {
  return data?.pages.flatMap(p => p.sessions) ?? [];
}

/* --- Hook --- */

export function useClientSessions() {
  return useInfiniteQuery<
    SessionsResponse,
    Error,
    InfiniteData<SessionsResponse>,
    QueryKey,
    string | undefined
  >({
    queryKey: queryKeys.sessionContainer.my,
    queryFn: ({ pageParam, signal }) => {
      const cursor = pageParam;
      return getMySessionContainers_IO(
        cursor != null ? { cursor, take: 50 } : { take: 50 },
        { signal }
      );
    },
    getNextPageParam: lastPage => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined,
    staleTime: 30_000,
  });
}
