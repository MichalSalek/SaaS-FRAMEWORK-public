// UI/features/gallery/hooks/useUpdateGalleryRecord.ts
// TQ v5 mutation -- PATCH /api/v1/gallery/update-record
// Updates color_ids, trait_ids and/or nail_length on an existing gallery record.
// Stack: TanStack Query v5.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateGalleryRecord_IO } from '../../../../domain/gallery/galleryIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';

/* --- Types --- */

type UpdateRequest = GALLERY_DTO_API_V1['UPDATE_GALLERY_RECORD']['REQUEST'];

/* --- Hook --- */

export function useUpdateGalleryRecord() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: UpdateRequest) => updateGalleryRecord_IO(req),
    // suppressGlobalError + no local onError: the HTTP interceptor (event-bus
    // Stage 1) owns the error toast (backend gallery event or
    // INTERNET_CONNECTION_PROBLEM). suppressGlobalError disables the global
    // MutationCache fallback; a local push here duplicated the interceptor
    // (different key never dedups → two toasts).
    meta: { suppressGlobalError: true },

    onSettled: (_data, _error, variables) => {
      // Invalidate specific photo detail to reflect updated tags immediately.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gallery.byId(variables.gallery_record_id),
      });
      // Invalidate all gallery lists so own-gallery / explore caches are fresh.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gallery.all,
      });
    },
  });
}
