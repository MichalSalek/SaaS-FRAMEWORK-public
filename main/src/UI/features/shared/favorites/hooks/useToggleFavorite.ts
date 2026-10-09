// UI/features/shared/favorites/hooks/useToggleFavorite.ts
// TQ v5 mutation — optimistic favorite toggle for Explore gallery.
// Local Set<string> in parent handles optimistic UI; this hook fires the API call
// and invalidates favorite records on settle.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  addRecordToFavorites_IO,
  removeRecordFromFavorites_IO,
} from '../../../../../domain/favorites/favoriteIO.possibilities.api';
import { queryKeys } from '../../../../../application/http/queryKeys.factory';

/* ─── Types ─── */

interface ToggleFavoriteParams {
  gallery_record_id: string;
  isFavorited: boolean;
}

/* ─── Hook ─── */

export function useToggleFavorite() {
  const queryClient = useQueryClient();

  return useMutation({
    // suppressGlobalError: call-site (useRecordFavorites, useStylistGalleryPage) owns the error toast.
    // Without this the global MutationCache.onError fires a duplicate GENERAL_ERROR
    // (matches sibling toggles: useToggleLike/useTogglePin/useBookmarkStylist).
    meta: { suppressGlobalError: true },
    mutationFn: async ({
      gallery_record_id,
      isFavorited,
    }: ToggleFavoriteParams) => {
      if (isFavorited) {
        return removeRecordFromFavorites_IO({ gallery_record_id });
      }
      return addRecordToFavorites_IO({ gallery_record_id });
    },
    onSettled: () => {
      // Match useToggleLike scope: invalidate the entire favorite domain so
      // both .records and any future favorite-related queries refresh together.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.favorite.all,
      });
      // Explore gallery embeds is_favorited per record — must bust the explore
      // cache so stale boolean flags don't persist after the 2 min staleTime window.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gallery.all,
      });
    },
  });
}
