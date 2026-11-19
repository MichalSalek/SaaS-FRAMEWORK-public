// UI/features/shared/favorites/hooks/useFavoriteRecords.ts
// TQ v5 useInfiniteQuery -- GET /api/v1/favorite/get-records (cursor pagination)
// Fetches all gallery records favorited by the current user, page by page.
// Stack: TanStack Query v5.

import { useInfiniteQuery } from '@tanstack/react-query';
import type { InfiniteData, QueryKey } from '@tanstack/react-query';
import { getFavoriteRecords_IO } from '../../../../../domain/favorites/favoriteIO.possibilities.api';
import { queryKeys } from '../../../../../application/http/queryKeys.factory';
import type { FAVORITE_DTO_API_V1 } from '@kernel/models/favorites/favorite.dto';
import { useIsClient } from '../../../../shared/hooks/useSessionRole';
import { useCurrentUserAccount } from '../../../../shared/hooks/useCurrentUserAccount';

/* --- Types --- */

type FavoriteRecordsResponse =
  FAVORITE_DTO_API_V1['FAVORITE_GET_RECORDS']['RESPONSE'];

/* --- Helper: flatten infinite pages to flat records array --- */

export function flattenFavoriteRecordsPages(
  data: InfiniteData<FavoriteRecordsResponse> | undefined
): FavoriteRecordsResponse['records'] {
  return data?.pages.flatMap(p => p.records) ?? [];
}

/* --- Hook --- */

// Client mode alone is not an account: unfinished onboarding can report CLIENT.
// Wait for a confirmed profile, then respect the caller's narrower query gate.
export function useFavoriteRecords({
  enabled = true,
}: { enabled?: boolean } = {}) {
  const isClient = useIsClient();
  const { data: user } = useCurrentUserAccount();
  return useInfiniteQuery<
    FavoriteRecordsResponse,
    Error,
    InfiniteData<FavoriteRecordsResponse>,
    QueryKey,
    string | undefined
  >({
    queryKey: queryKeys.favorite.records,
    queryFn: ({ pageParam, signal }) => {
      const cursor = pageParam;
      return getFavoriteRecords_IO(
        cursor != null ? { cursor, take: 20 } : { take: 20 },
        { signal }
      );
    },
    getNextPageParam: lastPage => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined,
    staleTime: 60_000,
    enabled: enabled && isClient && user?.client_account != null,
  });
}
