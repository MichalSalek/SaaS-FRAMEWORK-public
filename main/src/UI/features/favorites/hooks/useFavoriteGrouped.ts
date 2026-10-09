// UI/features/favorites/hooks/useFavoriteGrouped.ts
// TQ v5 useQuery -- GET /api/v1/favorite/get-grouped
// Fetches all favorited gallery records grouped by stylist.
// Used by the "Grouped view" toggle on FavoritesPage.
// Stack: TanStack Query v5.

import { useQuery } from '@tanstack/react-query';
import { getFavoriteGrouped_IO } from '../../../../domain/favorites/favoriteIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { FAVORITE_DTO_API_V1 } from '@kernel/models/favorites/favorite.dto';

/* --- Types --- */

export type FavoriteGroupedResponse =
  FAVORITE_DTO_API_V1['FAVORITE_GET_GROUPED']['RESPONSE'];

export type FavoriteGroup =
  FAVORITE_DTO_API_V1['FAVORITE_GET_GROUPED']['RESPONSE']['groups'][number];

/* --- Hook --- */

export function useFavoriteGrouped(enabled: boolean) {
  return useQuery<FavoriteGroupedResponse>({
    queryKey: queryKeys.favorite.grouped,
    queryFn: ({ signal }) => getFavoriteGrouped_IO(undefined, { signal }),
    enabled,
    staleTime: 60_000,
  });
}
