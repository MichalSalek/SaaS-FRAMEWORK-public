// UI/features/shared/favorites/hooks/useUnbookmarkStylist.ts
// TQ v5 mutation -- POST /api/v1/bookmark/unbookmark-stylist
// Removes a stylist bookmark with optimistic update.
// Pattern: onMutate → cancel → snapshot → setQueryData → onError rollback → onSettled invalidate.
// Stack: TanStack Query v5.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import { unbookmarkStylist_IO } from '../../../../../domain/favorites/favoriteIO.possibilities.api';
import { queryKeys } from '../../../../../application/http/queryKeys.factory';
import { trackFlowStep } from '../../../../../application/analytics/flow-events';
import type { FAVORITE_DTO_API_V1 } from '@kernel/models/favorites/favorite.dto';

/* --- Types --- */

type UnbookmarkRequest = FAVORITE_DTO_API_V1['UNBOOKMARK_STYLIST']['REQUEST'];
type BookmarkedStylistsResponse =
  FAVORITE_DTO_API_V1['GET_BOOKMARKED_STYLISTS']['RESPONSE'];
type BookmarkedStylistsInfiniteData = InfiniteData<BookmarkedStylistsResponse>;

/* --- Hook --- */

export function useUnbookmarkStylist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: UnbookmarkRequest) => unbookmarkStylist_IO(req),
    meta: { suppressGlobalError: true },

    onMutate: async variables => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.bookmark.stylists,
      });

      const previousData =
        queryClient.getQueryData<BookmarkedStylistsInfiniteData>(
          queryKeys.bookmark.stylists
        );

      if (previousData) {
        queryClient.setQueryData<BookmarkedStylistsInfiniteData>(
          queryKeys.bookmark.stylists,
          old =>
            old
              ? {
                  ...old,
                  pages: old.pages.map(page => ({
                    ...page,
                    records: page.records.filter(
                      s => s.stylist_account_id !== variables.stylist_account_id
                    ),
                  })),
                }
              : old
        );
      }

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
      trackFlowStep('favorites', 'stylist_unsaved');
    },

    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.bookmark.all,
      });
    },
  });
}
