import { useLocale } from 'next-intl';
import { useMemo } from 'react';
import { getLocalizedTaxonomyName } from '../../../../../domain/gallery/gallery-taxonomy.locale';
// UI/features/shared/gallery/hooks/useGalleryColors.ts
// TQ v5 query — GET /api/v1/gallery/colors
// Returns all available colors for gallery filtering.

import { queryOptions, useQuery } from '@tanstack/react-query';
import { getColors_IO } from '../../../../../domain/gallery/galleryIO.possibilities.api';
import { queryKeys } from '../../../../../application/http/queryKeys.factory';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';

/* ─── Query options ─── */

const galleryColorsQueryOptions = queryOptions({
  queryKey: queryKeys.gallery.colors,
  queryFn: ({ signal }) => getColors_IO(undefined, { signal }),
  staleTime: 5 * 60_000, // 5 min — colors rarely change
});

/* ─── Stable empty fallback (avoids identity churn on every render) ─── */

type ColorDTO = GALLERY_DTO_API_V1['GET_COLORS']['RESPONSE'][number];
// Module-scope constant — same reference across all renders, prevents
// downstream useMemo deps from recomputing when data is undefined.
const EMPTY_COLORS: ColorDTO[] = [];

/* ─── Hook ─── */

export function useGalleryColors() {
  const locale = useLocale();
  const { data, isLoading, isError, isFetching, refetch } = useQuery(
    galleryColorsQueryOptions
  );

  const colors = useMemo(
    () =>
      data?.map(item => ({
        ...item,
        name: getLocalizedTaxonomyName(item.name, locale),
      })) ?? EMPTY_COLORS,
    [data, locale]
  );

  return {
    colors,
    isLoading,
    isError,
    isFetching,
    refetch,
  };
}
