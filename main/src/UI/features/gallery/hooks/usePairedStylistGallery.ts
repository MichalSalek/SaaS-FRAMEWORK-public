import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { InfiniteData, QueryKey } from '@tanstack/react-query';
import { galleryGetForPairedClient_IO } from '../../../../domain/gallery/galleryIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';
import { useGalleryFiltersState } from '../../shared/gallery/hooks/useGalleryFiltersState';
import { useFetchRemainingPages } from '../../shared/gallery/hooks/useFetchRemainingPages';

type PairedGalleryResponse =
  GALLERY_DTO_API_V1['GALLERY_GET_FOR_PAIRED_CLIENT']['RESPONSE'];

export type PairedGalleryRecord = PairedGalleryResponse['records'][number];

type PairedStylistInfo = PairedGalleryResponse['stylist_info'];

// Backend caps a single page at 100 (`Math.min(limit || 50, 100)`); the default
// without `limit` was 50, which silently truncated the gallery for any stylist
// with more photos.
const PAIRED_PAGE_SIZE = 100;

// DECISION: "the full gallery after pairing" (DOMAIN_SSOT §4.2) = ALL of the stylist's photos, so
// the hook pulls pages up to the response's `total_count`: with no limit or offset the backend cut
// the response at 50 records and a paired client never saw the rest (nor a signal that there was
// more). Client-side filters (useGalleryFiltersState) work on the flattened set, so pages load
// eagerly, not on scroll: a filter over an incomplete set would lie "no results". The set is
// bounded by one stylist, so the cost is a few requests of 100 records in the rare large-portfolio
// case.
export function usePairedStylistGallery(accountId: string, enabled = true) {
  const query = useInfiniteQuery<
    PairedGalleryResponse,
    Error,
    InfiniteData<PairedGalleryResponse>,
    QueryKey,
    number
  >({
    queryKey: queryKeys.gallery.byAccountPaired(accountId),
    queryFn: ({ pageParam, signal }) =>
      galleryGetForPairedClient_IO(
        {
          stylist_account_id: accountId,
          limit: PAIRED_PAGE_SIZE,
          offset: pageParam,
        },
        { signal }
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((n, p) => n + p.records.length, 0);
      // Empty page = defensive stop (total_count drifted since the first page).
      return lastPage.records.length > 0 && loaded < lastPage.total_count
        ? loaded
        : undefined;
    },
    enabled: enabled && accountId.length > 0,
    staleTime: 30_000,
  });

  // Stop on a failed page (see the DECISION in useFetchRemainingPages).
  const {
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  } = query;
  useFetchRemainingPages(true, {
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  });

  const allRecords: PairedGalleryRecord[] = useMemo(
    () => query.data?.pages.flatMap(p => p.records) ?? [],
    [query.data]
  );
  const stylistInfo: PairedStylistInfo | null =
    query.data?.pages[0]?.stylist_info ?? null;

  const filterState = useGalleryFiltersState<PairedGalleryRecord>(allRecords);

  return {
    allRecords,
    stylistInfo,
    isLoading: query.isLoading,
    isError: query.isError,
    hasData: query.data !== undefined,
    refetch: query.refetch,
    isFetching: query.isFetching,
    // Eager pagination (DECISION above): while this is true the flattened set
    // is still partial, so filters and counts are lower bounds.
    hasNextPage,
    isFetchingNextPage,
    // A failed page stops the eager loop; the page renders an inline retry
    // that calls fetchNextPage (keeps the pages already loaded).
    isFetchNextPageError,
    fetchNextPage,
    ...filterState,
  };
}
