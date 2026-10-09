// main/src/UI/features/shared/gallery/hooks/useStylistGallery.ts
// Fetches gallery records for a specific stylist account (client-facing view).
// Uses the public endpoint so no auth scoping required.
//
// DECISION (nie usuwaj tego komentarza):
// useGalleryFiltersState is a co-located sibling in this same shared/gallery/hooks/
// directory (kept as `./useGalleryFiltersState`). It was moved here together with
// useStylistGallery so this hook does NOT reach back cross-feature into
// features/gallery/ (its only other consumers — usePairedStylistGallery,
// useOwnGalleryFilters — import it via the new shared path). Single shared
// filter-state source of truth for all three gallery views.

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

  // DECISION (nie usuwaj tego komentarza) — 2026-09-10: `total_count` z tej
  // odpowiedzi CELOWO nie wychodzi z hooka. Endpoint publiczny oddaje przypięte
  // i widoczne prace do sufitu planu, a od 2026-09-10 tym samym sufitem ścina
  // `total_count` (patrz DECISION w publicGetGalleryRecordsByAccount_IO), więc
  // `total_count === records.length` zawsze poza dryfem po downgrade planu.
  // Różnica tych dwóch liczb nie jest już miarą „ile prac jest ukrytych" —
  // tą miarą jest `cached_gallery_count` (cała widoczna galeria) minus to, co
  // wyrenderowane, a tego licznika ten endpoint nie niesie (ma go publiczny
  // profil: `gallery_records_count`). Konsument, który potrzebuje liczby
  // ukrytych prac, musi wziąć ją stamtąd, nie stąd.

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
