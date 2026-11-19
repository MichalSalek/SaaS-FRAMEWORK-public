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
import { trackFlowStep } from '../../../../application/analytics/flow-events';
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
      // DECISION: no local error toast, the HTTP interceptor owns it (three toast layers:
      // main/src/application/http/queryClient.config.ts). onError does only the optimistic
      // rollback.
      if (context?.previousData !== undefined) {
        queryClient.setQueryData(
          queryKeys.favorite.records,
          context.previousData
        );
      }
    },

    onSuccess: (_data, variables) => {
      trackFlowStep('favorites', 'note_saved', {
        cleared: variables.note === null,
      });
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
