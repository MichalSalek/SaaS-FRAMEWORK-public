// UI/features/shared/favorites/hooks/useBookmarkedStylists.ts
// TQ v5 useInfiniteQuery -- GET /api/v1/bookmark/get-bookmarked (cursor pagination)
// Fetches all stylists bookmarked by the current user, page by page.
// Stack: TanStack Query v5.

import { useInfiniteQuery } from '@tanstack/react-query';
import { getBookmarkedStylists_IO } from '../../../../../domain/favorites/favoriteIO.possibilities.api';
import { queryKeys } from '../../../../../application/http/queryKeys.factory';
// useSessionRole lives at UI/shared/hooks/ (NOT features/shared/hooks/); from this
// 5-levels-deep location that resolves to ../../../../shared/hooks/useSessionRole.
import { useIsClient } from '../../../../shared/hooks/useSessionRole';
import type { FAVORITE_DTO_API_V1 } from '@kernel/models/favorites/favorite.dto';
import type { InfiniteData, QueryKey } from '@tanstack/react-query';

/* --- Types --- */

type BookmarkedStylistsResponse =
  FAVORITE_DTO_API_V1['GET_BOOKMARKED_STYLISTS']['RESPONSE'];

/* --- Helper: flatten infinite pages to flat records array --- */

export function flattenBookmarkedPages(
  data: InfiniteData<BookmarkedStylistsResponse> | undefined
): BookmarkedStylistsResponse['records'] {
  return data?.pages.flatMap(p => p.records) ?? [];
}

/* --- Hook --- */

export function useBookmarkedStylists(enabled = true) {
  // BOOKMARK_STYLIST is a CLIENT-only capability — the endpoint 403s for a
  // stylist-mode session. Gate the query on client mode so it never fires for
  // non-clients (the isBookmarked result is meaningless for a stylist anyway).
  // `enabled` param: caller może dołożyć twardszy warunek (S76: publiczny
  // profil wymaga POTWIERDZONEGO client_account — sesja roleless-usera po
  // porzuconym onboardingu raportuje accountType CLIENT bez wiersza w DB,
  // więc sam useIsClient przepuszczał query prosto w 403).
  const isClient = useIsClient();
  return useInfiniteQuery<
    BookmarkedStylistsResponse,
    Error,
    InfiniteData<BookmarkedStylistsResponse>,
    QueryKey,
    string | undefined
  >({
    queryKey: queryKeys.bookmark.stylists,
    queryFn: ({ pageParam, signal }) => {
      const cursor = pageParam;
      return getBookmarkedStylists_IO(
        cursor != null ? { cursor, take: 20 } : { take: 20 },
        { signal }
      );
    },
    getNextPageParam: lastPage => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined,
    enabled: isClient && enabled,
    staleTime: 60_000,
  });
}
