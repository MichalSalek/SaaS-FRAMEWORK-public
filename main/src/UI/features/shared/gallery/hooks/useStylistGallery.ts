// main/src/UI/features/shared/gallery/hooks/useStylistGallery.ts
// Fetches gallery records for a specific stylist account (client-facing view).
// Uses the public endpoint so no auth scoping required.
//
// useGalleryFiltersState lives in shared/gallery/hooks so all three gallery views share one
// filter-state source without importing across features.

import { useMemo } from 'react';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { publicGetGalleryRecordsByAccount_IO } from '../../../../../domain/gallery/galleryIO.possibilities.api';
import { queryKeys } from '../../../../../application/http/queryKeys.factory';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';
import { useGalleryFiltersState } from './useGalleryFiltersState';

/* ─── Types ─── */

export type StylistGalleryRecord =
  GALLERY_DTO_API_V1['PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT']['RESPONSE']['records'][number];

type StylistInfo =
  GALLERY_DTO_API_V1['PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT']['RESPONSE']['stylist_info'];

/* ─── Query options ─── */

const stylistGalleryQueryOptions = (accountId: string) =>
  queryOptions({
    queryKey: queryKeys.gallery.byAccount(accountId),
    queryFn: ({ signal }) =>
      publicGetGalleryRecordsByAccount_IO(
        { account_id: accountId },
        { signal }
      ),
    enabled: accountId.length > 0,
    staleTime: 30_000,
  });

/* ─── Hook ─── */

export function useStylistGallery(accountId: string) {
  const query = useQuery(stylistGalleryQueryOptions(accountId));

  const allRecords: StylistGalleryRecord[] = useMemo(
    () => query.data?.records ?? [],
    [query.data]
  );
  const stylistInfo: StylistInfo | null = query.data?.stylist_info ?? null;
  const showWatermark: boolean = query.data?.show_watermark ?? false;

  // DECISION: `total_count` deliberately does not leave this hook. The public endpoint caps the
  // records AND `total_count` at the plan ceiling (publicGetGalleryRecordsByAccount_IO in
  // web-1/src/domain/gallery/operations/gallery-public.operations.ts), so it equals
  // records.length and says nothing about hidden works. A consumer that needs that number takes
  // the public profile's `gallery_records_count`.

  const filterState = useGalleryFiltersState<StylistGalleryRecord>(allRecords);

  return {
    /* data */
    allRecords,
    stylistInfo,
    showWatermark,
    /* status */
    isLoading: query.isLoading,
    isError: query.isError,
    isFetching: query.isFetching,
    hasData: query.data !== undefined,
    refetch: query.refetch,
    /* filter state + handlers (delegated to shared hook) */
    ...filterState,
  };
}
