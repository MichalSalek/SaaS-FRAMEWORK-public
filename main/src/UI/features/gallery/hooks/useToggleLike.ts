// main/src/UI/features/gallery/hooks/useToggleLike.ts
// TQ v5 mutation -- toggles favorite (like) on a gallery record.
// Optimistic update on the detail query cache.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  addRecordToFavorites_IO,
  removeRecordFromFavorites_IO,
} from '../../../../domain/favorites/favoriteIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { trackFlowStep } from '../../../../application/analytics/flow-events';
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

    // DECISION: optimistic like has a double-tap race: two quick mutations can roll back to the
    // same snapshot (e.g. is_favorited=false for both), a transient flicker of the heart. Accepted:
    // (1) the server is the source of truth; remove is a deleteMany, so removing a missing like
    // is a no-op (Test: web-1/src/test-utils/integration/favorite-remove-record.test.ts covers
    // remove without a like answering 200 with nothing deleted; not concurrent requests), and
    // add maps the Prisma P2002 unique conflict (no test pins that path); (2) onSettled
    // invalidates detailKey + favorite.all + gallery.all, which refetches the final state;
    // (3) the flicker is sub-second and needs a deliberate double tap. A debounce or serial
    // queue is low ROI pre-launch.
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

    onSuccess: (_data, isFavorited) => {
      trackFlowStep(
        'favorites',
        isFavorited ? 'photo_unliked' : 'photo_liked',
        {
          surface: 'photo_detail',
        }
      );
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
