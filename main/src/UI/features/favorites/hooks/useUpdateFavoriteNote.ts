// UI/features/favorites/hooks/useUpdateFavoriteNote.ts
// TQ v5 mutation -- POST /api/v1/favorite/update-record-note
// Updates the personal note on a favorited gallery record.
// On success: optimistic update via setQueryData on the infinite cache shape,
// then invalidate to sync server state.
// Stack: TanStack Query v5.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import { updateFavoriteRecordNote_IO } from '../../../../domain/favorites/favoriteIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { FAVORITE_DTO_API_V1 } from '@kernel/models/favorites/favorite.dto';

/* --- Types --- */

type UpdateNoteRequest =
  FAVORITE_DTO_API_V1['FAVORITE_UPDATE_RECORD_NOTE']['REQUEST'];
type FavoriteRecordsResponse =
  FAVORITE_DTO_API_V1['FAVORITE_GET_RECORDS']['RESPONSE'];
type FavoriteRecordsInfiniteData = InfiniteData<FavoriteRecordsResponse>;

/* --- Hook --- */

export function useUpdateFavoriteNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: UpdateNoteRequest) => updateFavoriteRecordNote_IO(req),
    meta: { suppressGlobalError: true },

    onMutate: async variables => {
      await queryClient.cancelQueries({ queryKey: queryKeys.favorite.records });

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
                    records: page.records.map(r =>
                      r.gallery_record_id === variables.gallery_record_id
                        ? { ...r, note: variables.note }
                        : r
                    ),
                  })),
                }
              : old
        );
      }

      return { previousData };
    },

    onError: (_err, _variables, context) => {
      // DECISION (nie usuwaj tego komentarza):
      // onError robi TYLKO optimistic-rollback -- brak lokalnego pushNewSnackbar.
      // Toast bledu nalezy do http.interceptor (event-bus, Stage 1): mutationFn jest
      // czysto-transportowy i nie ustawia silentBusinessError, wiec interceptor ZAWSZE
      // pokazuje snackbar (event backendu na 4xx, INTERNET_CONNECTION_PROBLEM na sieci).
      // Lokalny push CANNOT_UPDATE_RECORD_NOTE (event frontend-only, backend go nie emituje)
      // to inny klucz niz interceptora -> nigdy nie dedupuje -> podwojny toast. Usuniety.
      if (context?.previousData !== undefined) {
        queryClient.setQueryData(
          queryKeys.favorite.records,
          context.previousData
        );
      }
    },

    onSettled: () => {
      // Invalidate the favorite prefix, not just .records. `favorite.grouped` is a
      // SIBLING key (not a child of .records), so a records-only invalidation left
      // the grouped view stale after a note edit. `favorite.all` covers records +
      // grouped — same pattern as useRemoveFavorite. (Optimistic onMutate/onError
      // above still target .records, the infinite-list cache shape being patched.)
      void queryClient.invalidateQueries({
        queryKey: queryKeys.favorite.all,
      });
    },
  });
}
