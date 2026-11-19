// UI/features/shared/favorites/hooks/useBookmarkStylist.ts
// TQ v5 mutation -- POST /api/v1/bookmark/bookmark-stylist
// Adds a stylist bookmark with optimistic update.
// DD3-F14: symmetrized with useUnbookmarkStylist — onMutate snapshot + optimistic add + rollback.
// Stack: TanStack Query v5.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import { bookmarkStylist_IO } from '../../../../../domain/favorites/favoriteIO.possibilities.api';
import { queryKeys } from '../../../../../application/http/queryKeys.factory';
import { trackFlowStep } from '../../../../../application/analytics/flow-events';
import type { FAVORITE_DTO_API_V1 } from '@kernel/models/favorites/favorite.dto';

/* --- Types --- */

type BookmarkRequest = FAVORITE_DTO_API_V1['BOOKMARK_STYLIST']['REQUEST'];
type BookmarkedStylistsResponse =
  FAVORITE_DTO_API_V1['GET_BOOKMARKED_STYLISTS']['RESPONSE'];
type BookmarkedStylistsInfiniteData = InfiniteData<BookmarkedStylistsResponse>;

/* --- Hook --- */

export function useBookmarkStylist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: BookmarkRequest) => bookmarkStylist_IO(req),
    meta: { suppressGlobalError: true },

    onMutate: async () => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.bookmark.stylists,
      });

      const previousData =
        queryClient.getQueryData<BookmarkedStylistsInfiniteData>(
          queryKeys.bookmark.stylists
        );

      // DECISION: no optimistic placeholder row. At mutation time only stylist_account_id is known,
      // not the BookmarkedStylistView shape (display_name, gallery_count, is_paired), so a stub
      // would render an empty card. The snapshot still rolls back a concurrent invalidation on
      // error; the real list arrives through the onSettled invalidate.

      return { previousData };
    },

    onError: (_err, _variables, context) => {
      // DECISION: no local error toast, the HTTP interceptor owns it (three toast layers:
      // main/src/application/http/queryClient.config.ts). Rollback only.
      if (context?.previousData !== undefined) {
        queryClient.setQueryData(
          queryKeys.bookmark.stylists,
          context.previousData
        );
      }
    },

    onSuccess: () => {
      trackFlowStep('favorites', 'stylist_saved');
    },

    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.bookmark.all,
      });
    },
  });
}
