// UI/features/explore/hooks/useExploreGallery.ts
// TQ v5 useInfiniteQuery — cursor-based pagination for /api/v1/gallery/explore
// queryKey includes filters so TQ auto-refetches on filter change.

import { useInfiniteQuery } from '@tanstack/react-query';
import type { InfiniteData, QueryKey } from '@tanstack/react-query';
import { exploreGalleryRecords_IO } from '../../../../domain/gallery/galleryIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';
import type { ExploreFilters } from './useGalleryFilters';

/* ─── Types ─── */

type ExploreRequest = GALLERY_DTO_API_V1['EXPLORE_GALLERY_RECORDS']['REQUEST'];
type ExploreResponse =
  GALLERY_DTO_API_V1['EXPLORE_GALLERY_RECORDS']['RESPONSE'];

/** Build request params, omitting undefined fields for exactOptionalPropertyTypes. */
function buildQueryParams(filters: ExploreFilters): ExploreRequest {
  const params: ExploreRequest = { take: 12 };
  if (filters.color_ids.length > 0) {
    params.color_ids = filters.color_ids;
  }
  if (filters.trait_ids.length > 0) {
    params.trait_ids = filters.trait_ids;
  }
  if (filters.nail_length) {
    params.nail_length = filters.nail_length;
  }
  if (filters.apply_strict_filter) {
    params.apply_strict_filter = true;
  }
  if (filters.city) {
    params.city = filters.city;
  }
  if (filters.searchQuery) {
    params.searchQuery = filters.searchQuery;
  }
  return params;
}

/* ─── Hook ─── */

export function useExploreGallery(filters: ExploreFilters) {
  const queryParams = buildQueryParams(filters);

  return useInfiniteQuery<
    ExploreResponse,
    Error,
    InfiniteData<ExploreResponse>,
    QueryKey,
    string | undefined
  >({
    queryKey: queryKeys.gallery.explore(queryParams),
    queryFn: ({ pageParam, signal }) => {
      const req: ExploreRequest = { ...queryParams };
      if (pageParam != null) {
        req.cursor = pageParam;
      }
      return exploreGalleryRecords_IO(req, { signal });
    },
    getNextPageParam: lastPage => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined,
    staleTime: 2 * 60_000,
  });
}
