// UI/features/gallery/hooks/useStyleDetailData.ts
// Data orchestration for Style Detail (W2.5 iter 1).
//
// Pulls:
//   1) All traits via useGalleryTraits() — find current trait by id
//   2) Filtered gallery via useInfiniteQuery on EXPLORE_GALLERY_RECORDS,
//      scoped to trait_ids: [id] (+ optional nail_length filter)
//
// Returns:
//   - currentTrait     | the trait being viewed (or null)
//   - allTraits        | all traits for related row composition
//   - records          | flat array (all pages concatenated)
//   - fetchNextPage    | infinite scroll
//   - hasNextPage      | pagination state
//   - isFetchingNextPage
//   - isLoading        | first page
//   - isError          | fetch error
//   - refetch          | retry handler
//   - selectedLength   | current nail_length filter (or null = all)
//   - setSelectedLength
//   - lengthCounts     | per-length counts derived from loaded records
//                       (used by length chips for badge counts)
//   - uniqueStylists   | distinct stylist count across loaded records
//   - uniqueColors     | distinct color count across loaded records

import { useInfiniteQuery } from '@tanstack/react-query';
import type { InfiniteData, QueryKey } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { NAIL_LENGTHS } from '@kernel/domain/gallery/nail-length.config';
import type { NailLength } from '@kernel/domain/gallery/nail-length.config';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';
import { exploreGalleryRecords_IO } from '../../../../domain/gallery/galleryIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { useGalleryTraits } from '../../shared/gallery/hooks/useGalleryTraits';

/* ─── Types ─── */

type ExploreRequest = GALLERY_DTO_API_V1['EXPLORE_GALLERY_RECORDS']['REQUEST'];
type ExploreResponse =
  GALLERY_DTO_API_V1['EXPLORE_GALLERY_RECORDS']['RESPONSE'];
export type StyleRecord = ExploreResponse['records'][number];

/* ─── Hook ─── */

export function useStyleDetailData(styleId: string) {
  /* All traits (for current + related). Cached 5 min. */
  const {
    traits,
    isLoading: traitsLoading,
    isError: traitsQueryError,
    refetch: refetchTraits,
  } = useGalleryTraits();
  // A failed BACKGROUND refetch with the trait list already cached is not a
  // page-level failure: the list is there, the page renders from it.
  const traitsError = traitsQueryError && traits.length === 0;

  const currentTrait = traits.find(t => t.id === styleId) ?? null;

  /* Length filter — null = all lengths. */
  const [selectedLength, setSelectedLengthState] = useState<NailLength | null>(
    null
  );

  const setSelectedLength = (length: NailLength | null) => {
    setSelectedLengthState(length);
  };

  const clearLength = () => {
    setSelectedLengthState(null);
  };

  /* Build query params — trait_ids always present, nail_length optional. */
  const queryParams: ExploreRequest = (() => {
    const params: ExploreRequest = {
      take: 24,
      trait_ids: [styleId],
    };
    if (selectedLength) {
      params.nail_length = selectedLength;
    }
    return params;
  })();

  /* Infinite query. */
  const query = useInfiniteQuery<
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
    enabled: Boolean(currentTrait), // only fetch if trait exists
  });

  /* Flat records (all pages). */
  const records: StyleRecord[] = useMemo(() => {
    if (!query.data) {
      return [];
    }
    return query.data.pages.flatMap(p => p.records);
  }, [query.data]);

  /* Derived stats. */
  const uniqueStylists = useMemo(() => {
    const ids = new Set<string>();
    for (const r of records) {
      if (r.created_by_account?.account_id) {
        ids.add(r.created_by_account.account_id);
      }
    }
    return ids.size;
  }, [records]);

  const uniqueColors = useMemo(() => {
    const ids = new Set<string>();
    for (const r of records) {
      r.colors?.forEach(c => ids.add(c.id));
    }
    return ids.size;
  }, [records]);

  /* Length counts — derived from loaded pages. UX honest: shows counts
   * for what we have, not pretending we know total for unloaded pages. */
  const lengthCounts = useMemo(() => {
    const counts: Record<NailLength, number> = {
      [NAIL_LENGTHS.SHORT]: 0,
      [NAIL_LENGTHS.MEDIUM]: 0,
      [NAIL_LENGTHS.LONG]: 0,
      [NAIL_LENGTHS.XL]: 0,
    };
    for (const r of records) {
      const len = r.nail_length;
      if (len in counts) {
        counts[len] += 1;
      }
    }
    return counts;
  }, [records]);

  const isLoadingFirstPage =
    traitsLoading ||
    (query.isLoading && Boolean(currentTrait)) ||
    (query.isFetching && records.length === 0 && Boolean(currentTrait));

  return {
    currentTrait,
    allTraits: traits,
    traitsLoading,
    traitsError,
    refetchTraits,
    records,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    isFetchNextPageError: query.isFetchNextPageError,
    isLoading: isLoadingFirstPage,
    // Page-level failure only without data: a failed next page or background
    // refetch keeps the loaded records (next-page retry lives in the grid).
    isError: query.isError && query.data === undefined,
    refetch: query.refetch,
    selectedLength,
    setSelectedLength,
    clearLength,
    lengthCounts,
    uniqueStylists,
    uniqueColors,
  };
}
