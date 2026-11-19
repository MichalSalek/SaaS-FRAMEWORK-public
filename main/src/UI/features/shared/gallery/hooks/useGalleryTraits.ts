import { useLocale } from 'next-intl';
import { useMemo } from 'react';
import { getLocalizedTaxonomyName } from '../../../../../domain/gallery/gallery-taxonomy.locale';
// UI/features/shared/gallery/hooks/useGalleryTraits.ts
// TQ v5 query — GET /api/v1/gallery/traits
// Returns all available traits for gallery filtering.

import { queryOptions, useQuery } from '@tanstack/react-query';
import { getTraits_IO } from '../../../../../domain/gallery/galleryIO.possibilities.api';
import { queryKeys } from '../../../../../application/http/queryKeys.factory';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';

/* ─── Query options ─── */

const galleryTraitsQueryOptions = queryOptions({
  queryKey: queryKeys.gallery.traits,
  queryFn: ({ signal }) => getTraits_IO({}, { signal }),
  staleTime: 5 * 60_000, // 5 min — traits rarely change
});

/* ─── Stable empty fallback (avoids identity churn on every render) ─── */

type TraitDTO = GALLERY_DTO_API_V1['GET_TRAITS']['RESPONSE'][number];
// Module-scope constant — same reference across all renders, prevents
// downstream useMemo deps from recomputing when data is undefined.
const EMPTY_TRAITS: TraitDTO[] = [];

/* ─── Hook ─── */

export function useGalleryTraits() {
  const locale = useLocale();
  const { data, isLoading, isError, isFetching, refetch } = useQuery(
    galleryTraitsQueryOptions
  );

  const traits = useMemo(
    () =>
      data?.map(item => ({
        ...item,
        name: getLocalizedTaxonomyName(item.name, locale),
      })) ?? EMPTY_TRAITS,
    [data, locale]
  );

  return {
    traits,
    isLoading,
    isError,
    isFetching,
    refetch,
  };
}
