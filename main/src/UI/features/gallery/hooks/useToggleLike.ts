// main/src/UI/features/gallery/hooks/useToggleLike.ts
// TQ v5 mutation -- toggles favorite (like) on a gallery record.
// Optimistic update on the detail query cache.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  addRecordToFavorites_IO,
  removeRecordFromFavorites_IO,
} from '../../../../domain/favorites/favoriteIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { PhotoDetailData } from '../../shared/gallery/hooks/usePhotoDetail';

/* --- Hook --- */

export function useToggleLike(galleryRecordId: string) {
  const queryClient = useQueryClient();
  const detailKey = queryKeys.gallery.byId(galleryRecordId);

  return useMutation({
    mutationFn: async (isFavorited: boolean): Promise<void> => {
      const req = { gallery_record_id: galleryRecordId };
      if (isFavorited) {
        await removeRecordFromFavorites_IO(req);
      } else {
        await addRecordToFavorites_IO(req);
      }
    },
    meta: { suppressGlobalError: true },

    // DECISION (nie usuwaj tego komentarza):
    // Optimistic like — double-tap race: dwie szybkie mutacje mogą ustawić
    // onError rollback do tego samego snapshotu (np. is_favorited=false dla
    // obydwu), co powoduje przejściowe "migotanie" ikony serca.
    // To AKCEPTOWALNE z trzech powodów:
    // 1. Server jest autorytatywnym SoT: add/remove są idempotentne
    //    (add → Prisma P2002 unique conflict handled, remove → deleteMany 0).
    // 2. onSettled triple-invalidation (detailKey + favorite.all + gallery.all)
    //    zawsze reconciluje finalny stan z serwerem po zakończeniu mutacji.
    // 3. Migotanie jest wizualnie subsekundowe i wymaga celowego double-tapa.
    // Poprawa (debounce lub serial-queue) to NISKI ROI pre-launch — odkładamy.
    onMutate: async (isFavorited: boolean) => {
      await queryClient.cancelQueries({ queryKey: detailKey });

      const snapshot = queryClient.getQueryData<PhotoDetailData>(detailKey);

      queryClient.setQueryData<PhotoDetailData>(detailKey, prev => {
        if (!prev) {
          return prev;
        }
        return { ...prev, is_favorited: !isFavorited };
      });

      return { snapshot };
    },

    // Error toast owned by the HTTP interceptor (event-bus Stage 1): the backend
    // emits CANNOT_ADD_RECORD_TO_FAVORITES (add) / RECORD_NOT_IN_FAVORITES (remove),
    // or INTERNET_CONNECTION_PROBLEM on network. A local push stacked a second toast
    // (different key never dedups) — this handler only rolls the heart back.
    onError: (_err, _vars, context) => {
      if (context?.snapshot !== undefined) {
        queryClient.setQueryData<PhotoDetailData>(detailKey, context.snapshot);
      }
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: detailKey });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.favorite.all,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gallery.all,
      });
    },
  });
}
