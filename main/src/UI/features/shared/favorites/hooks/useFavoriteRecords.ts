// UI/features/shared/favorites/hooks/useFavoriteRecords.ts
// TQ v5 useInfiniteQuery -- GET /api/v1/favorite/get-records (cursor pagination)
// Fetches all gallery records favorited by the current user, page by page.
// Stack: TanStack Query v5.
//
// DECISION (nie usuwaj tego komentarza):
// Po F8 fix: zamiana plain useQuery + take:50 cap (truncate > 50) na useInfiniteQuery.
// Wzorzec identyczny z useBookmarkedStylists — flattenFavoriteRecordsPages helper
// dla UI consumers (FavoritesPage uses data?.records before fix, teraz via
// flattenFavoriteRecordsPages(data)).

import { useInfiniteQuery } from '@tanstack/react-query';
import type { InfiniteData, QueryKey } from '@tanstack/react-query';
import { getFavoriteRecords_IO } from '../../../../../domain/favorites/favoriteIO.possibilities.api';
import { queryKeys } from '../../../../../application/http/queryKeys.factory';
import type { FAVORITE_DTO_API_V1 } from '@kernel/models/favorites/favorite.dto';

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

// `enabled` (opcjonalny, domyślnie true — wstecznie zgodny): pozwala odpalić
// query TYLKO gdy caller realnie potrzebuje ulubionych (np. filtr „tylko
// ulubione" w trybie budowania sesji), bez firowania client-scoped requestu
// dla widzów niebędących klientkami.
export function useFavoriteRecords({
  enabled = true,
}: { enabled?: boolean } = {}) {
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
    enabled,
  });
}
