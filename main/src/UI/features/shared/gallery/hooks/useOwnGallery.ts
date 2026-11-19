// UI/features/shared/gallery/hooks/useOwnGallery.ts
// TQ v5 useInfiniteQuery — cursor-based pagination for /api/v1/gallery/get-records (own gallery, auth-scoped).
// Stack: TanStack Query v5.

import { useInfiniteQuery } from '@tanstack/react-query';
import { getGalleryRecords_IO } from '../../../../../domain/gallery/galleryIO.possibilities.api';
import { queryKeys } from '../../../../../application/http/queryKeys.factory';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';
import type { InfiniteData, QueryKey } from '@tanstack/react-query';

/* --- Types --- */

type GalleryResponse = GALLERY_DTO_API_V1['GET_GALLERY_RECORDS']['RESPONSE'];
type GalleryRecord = GalleryResponse['records'][number];

const DEFAULT_FILTERS: GALLERY_DTO_API_V1['GET_GALLERY_RECORDS']['REQUEST'] = {
  color_ids: [],
  trait_ids: [],
  apply_strict_filter: false,
};

/* --- Flatten helper --- */

export function flattenGalleryPages(
  data: InfiniteData<GalleryResponse> | undefined
): GalleryRecord[] {
  return data?.pages.flatMap(p => p.records) ?? [];
}

/* --- Hook --- */

export function useOwnGallery() {
  return useInfiniteQuery<
    GalleryResponse,
    Error,
    InfiniteData<GalleryResponse>,
    QueryKey,
    string | undefined
  >({
    queryKey: queryKeys.gallery.records(DEFAULT_FILTERS),
    queryFn: ({ pageParam, signal }) => {
      const req: GALLERY_DTO_API_V1['GET_GALLERY_RECORDS']['REQUEST'] = {
        ...DEFAULT_FILTERS,
        take: 12,
      };
      if (pageParam != null) {
        req.cursor = pageParam;
      }
      return getGalleryRecords_IO(req, { signal });
    },
    getNextPageParam: lastPage => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined,
    staleTime: 30_000,
  });
}
