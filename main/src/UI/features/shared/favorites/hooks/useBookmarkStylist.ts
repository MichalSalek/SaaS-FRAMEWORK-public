// UI/features/shared/favorites/hooks/useBookmarkStylist.ts
// TQ v5 mutation -- POST /api/v1/bookmark/bookmark-stylist
// Adds a stylist bookmark with optimistic update.
// DD3-F14: symmetrized with useUnbookmarkStylist — onMutate snapshot + optimistic add + rollback.
// Stack: TanStack Query v5.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import { bookmarkStylist_IO } from '../../../../../domain/favorites/favoriteIO.possibilities.api';
import { queryKeys } from '../../../../../application/http/queryKeys.factory';
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

      // DECISION (nie usuwaj tego komentarza):
      // Don't add an optimistic placeholder row — we only have stylist_account_id at
      // mutation time, not the rich BookmarkedStylistView shape (display_name, gallery_count,
      // is_paired, etc.). Adding a stub would either render an empty card (worse UX than
      // waiting) or require server resolution before display. Snapshot+rollback on error
      // is still valuable for any concurrent invalidation race that lands during request.
      // Real list refresh happens via onSettled invalidate.

      return { previousData };
    },

    onError: (_err, _variables, context) => {
      // DECISION (nie usuwaj tego komentarza):
      // Brak lokalnego error-toasta jest celowy — toast błędu jest własnością
      // HTTP interceptora (event-bus, Stage 1): dla każdego failu tej pure-transport
      // mutacji interceptor pokazuje bardziej trafny event backendu
      // (STYLIST_ALREADY_BOOKMARKED / GENERAL_ERROR) albo INTERNET_CONNECTION_PROBLEM.
      // Lokalny push CANNOT_BOOKMARK_STYLIST (event front-only, backend go nie emituje)
      // dublował go (inny event-key nigdy nie dedupuje) → usunięty. Zostaje sam rollback.
      if (context?.previousData !== undefined) {
        queryClient.setQueryData(
          queryKeys.bookmark.stylists,
          context.previousData
        );
      }
    },

    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.bookmark.all,
      });
    },
  });
}
