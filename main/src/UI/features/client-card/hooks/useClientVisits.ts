import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { InfiniteData, QueryKey } from '@tanstack/react-query';
import type { VISIT_DTO_API_V1 } from '@kernel/models/visit/visit.dto';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { getClientVisits_IO } from '../../../../domain/visit/visitIO.possibilities.api';

export type ClientVisitsResponse =
  VISIT_DTO_API_V1['GET_CLIENT_VISITS']['RESPONSE'];

const VISITS_PAGE_SIZE = 30;

// Cursor-paginated (backend nextCursor, MAX_TAKE 50): a single page of 30 cut
// every client with a longer history off silently — the hero counted „30 wizyt"
// and the list ended, with no hint that older visits existed.
export function useClientVisits(clientUserId: string, enabled: boolean) {
  const query = useInfiniteQuery<
    ClientVisitsResponse,
    Error,
    InfiniteData<ClientVisitsResponse>,
    QueryKey,
    string | undefined
  >({
    queryKey: queryKeys.client.visits(clientUserId),
    queryFn: ({ pageParam, signal }) =>
      getClientVisits_IO(
        pageParam != null
          ? {
              client_user_id: clientUserId,
              cursor: pageParam,
              take: VISITS_PAGE_SIZE,
            }
          : { client_user_id: clientUserId, take: VISITS_PAGE_SIZE },
        { signal }
      ),
    getNextPageParam: lastPage => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined,
    enabled: enabled && clientUserId.length > 0,
    staleTime: 30_000,
  });

  const visits = useMemo(
    () => query.data?.pages.flatMap(p => p.visits) ?? [],
    [query.data]
  );
  // Plan-based history window travels with every page; the first one is enough.
  const historyAccess = query.data?.pages[0]?.historyAccess ?? null;

  return {
    visits,
    historyAccess,
    isLoading: query.isLoading,
    isError: query.isError,
    isFetching: query.isFetching,
    // TQ v5 keeps loaded pages when a refetch or the next page fails, and
    // isError alone does not say which — the card must not drop the list.
    hasData: query.data !== undefined,
    isFetchNextPageError: query.isFetchNextPageError,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch,
  };
}
