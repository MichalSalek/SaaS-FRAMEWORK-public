// UI/features/shared/hooks/useSharedSessions.ts
// TQ v5 useInfiniteQuery — cursor-based pagination for /api/v1/session-container/get-my
// Fetches all session containers for the current user (stylist sees shared ones).
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

function flattenSessionPages(
  data: InfiniteData<SessionsResponse> | undefined
): SessionContainerDTO[] {
  return data?.pages.flatMap(p => p.sessions) ?? [];
}

/* --- Hook --- */

export function useSharedSessions() {
  const query = useInfiniteQuery<
    SessionsResponse,
    Error,
    InfiniteData<SessionsResponse>,
    QueryKey,
    string | undefined
  >({
    queryKey: queryKeys.sessionContainer.myAsStylist,
    queryFn: ({ pageParam, signal }) => {
      const req: SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_GET_MY']['REQUEST'] =
        {
          take: 50,
          ...(pageParam != null && { cursor: pageParam }),
        };
      return getMySessionContainers_IO(req, { signal });
    },
    getNextPageParam: lastPage => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined,
    staleTime: 30_000,
  });

  return {
    ...query,
    sessions: flattenSessionPages(query.data),
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
