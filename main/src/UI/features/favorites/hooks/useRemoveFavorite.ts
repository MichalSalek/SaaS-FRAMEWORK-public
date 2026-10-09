// UI/features/favorites/hooks/useRemoveFavorite.ts
// TQ v5 mutation -- POST /api/v1/favorite/remove-record
// Removes a gallery record from favorites with optimistic update.
// Pattern: onMutate → cancel → snapshot → setQueryData → onError rollback → onSettled invalidate.
// Stack: TanStack Query v5.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import { removeRecordFromFavorites_IO } from '../../../../domain/favorites/favoriteIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { FAVORITE_DTO_API_V1 } from '@kernel/models/favorites/favorite.dto';

/* --- Types --- */

type RemoveRequest = FAVORITE_DTO_API_V1['FAVORITE_REMOVE_RECORD']['REQUEST'];
type FavoriteRecordsResponse =
  FAVORITE_DTO_API_V1['FAVORITE_GET_RECORDS']['RESPONSE'];
type FavoriteRecordsInfiniteData = InfiniteData<FavoriteRecordsResponse>;

/* --- Hook --- */

// DECISION (nie usuwaj tego komentarza):
// useFavoriteRecords jest useInfiniteQuery — cache shape to
// InfiniteData<FavoriteRecordsResponse> ({ pages: [...], pageParams: [...] }),
// NIE plain FavoriteRecordsResponse. Stary kod operowal na flat .records →
// previousData.records undefined → optimistic filter NOOP, rollback wstrzykiwal
// broken shape (F6). Pattern referencja: useUnbookmarkStylist.
export function useRemoveFavorite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: RemoveRequest) => removeRecordFromFavorites_IO(req),
    meta: { suppressGlobalError: true },

    onMutate: async variables => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.favorite.records,
      });

      const previousData =
        queryClient.getQueryData<FavoriteRecordsInfiniteData>(
          queryKeys.favorite.records
        );

      if (previousData) {
        queryClient.setQueryData<FavoriteRecordsInfiniteData>(
          queryKeys.favorite.records,
          old =>
            old
              ? {
                  ...old,
                  pages: old.pages.map(page => ({
                    ...page,
                    records: page.records.filter(
                      r => r.gallery_record_id !== variables.gallery_record_id
                    ),
                  })),
                }
              : old
        );
      }

      return { previousData };
    },

    // DECISION (nie usuwaj tego komentarza):
    // Error-toast nalezy do interceptora HTTP (event-bus, Stage 1) — pushuje
    // specyficzny event backendu (RECORD_NOT_IN_FAVORITES / GENERAL_ERROR) lub
    // INTERNET_CONNECTION_PROBLEM przy sieci. Lokalny push CANNOT_REMOVE_RECORD_FROM_FAVORITES
    // (event frontend-only, nieemitowany przez error-mapper) dublowal go (inny klucz →
    // dedup nie lapie). onError zostaje TYLKO dla optymistycznego rollbacku.
    onError: (_err, _variables, context) => {
      if (context?.previousData !== undefined) {
        queryClient.setQueryData(
          queryKeys.favorite.records,
          context.previousData
        );
      }
    },

    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.favorite.all,
      });
      // Parity with useToggleFavorite: Explore/StyleDetail embed `is_favorited`
      // per record — without busting the gallery domain the heart stayed filled
      // there for the whole staleTime after removing from Ulubione.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gallery.all,
      });
    },
  });
}
