// UI/features/gallery/hooks/useDeleteGalleryRecord.ts
// TQ v5 mutation -- POST /api/v1/gallery/delete-record
// Removes a gallery record with optimistic update.
// Stack: TanStack Query v5.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { deleteGalleryRecord_IO } from '../../../../domain/gallery/galleryIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';
import type { InfiniteData } from '@tanstack/react-query';

/* --- Types --- */

type DeleteRequest = GALLERY_DTO_API_V1['DELETE_GALLERY_RECORD']['REQUEST'];
type GalleryResponse = GALLERY_DTO_API_V1['GET_GALLERY_RECORDS']['RESPONSE'];
type GalleryInfiniteData = InfiniteData<GalleryResponse>;

/* --- Hook --- */

export function useDeleteGalleryRecord() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: DeleteRequest) => deleteGalleryRecord_IO(req),
    meta: { suppressGlobalError: true },

    onMutate: async variables => {
      // Cancel running refetches across all gallery keys
      await queryClient.cancelQueries({ queryKey: queryKeys.gallery.all });

      // Snapshot all gallery record queries for rollback
      const queries = queryClient.getQueriesData<GalleryInfiniteData>({
        queryKey: queryKeys.gallery.all,
      });

      // Optimistically remove from all matching infinite caches
      for (const [key, data] of queries) {
        if (
          data !== undefined &&
          data !== null &&
          typeof data === 'object' &&
          'pages' in data &&
          Array.isArray(data.pages)
        ) {
          queryClient.setQueryData<GalleryInfiniteData>(key, {
            ...data,
            pages: data.pages.map(page => ({
              ...page,
              records: page.records.filter(
                r => r.gallery_record_id !== variables.gallery_record_id
              ),
            })),
          });
        }
      }

      return { queries };
    },

    onError: (_err, _variables, context) => {
      // Error toast owned by the HTTP interceptor (event-bus Stage 1): the backend
      // emits the specific delete failure (GALLERY_RECORD_OWNERSHIP_ERROR /
      // GALLERY_RECORD_NOT_FOUND) or INTERNET_CONNECTION_PROBLEM on network. A local
      // push stacked a second toast (different key never dedups) — this handler only
      // rolls the optimistic removal back.
      if (context?.queries) {
        for (const [key, data] of context.queries) {
          queryClient.setQueryData(key, data);
        }
      }
    },

    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.gallery.all,
      });
      // DD3-F12: dashboard feed should drop deleted record from activity list
      void queryClient.invalidateQueries({
        queryKey: queryKeys.account.dashboardFeed,
      });
      // DD2-H2: usage bar (photo count vs limit) must reflect delete immediately
      void queryClient.invalidateQueries({
        queryKey: queryKeys.account.usageStats,
      });
    },
  });
}
