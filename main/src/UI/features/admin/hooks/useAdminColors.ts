// main/src/UI/features/admin/hooks/useAdminColors.ts
// TQ v5 query — GET /api/v1/gallery/colors (list of colors for admin management).
// Stack: TQ v5 queryOptions.

import { queryOptions, useQuery } from '@tanstack/react-query';
import { getColors_IO } from '../../../../domain/gallery/galleryIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';

/* ─── Types ─── */

type AdminColorsResponse = GALLERY_DTO_API_V1['GET_COLORS']['RESPONSE'];
export type AdminColor = AdminColorsResponse[number];

/* ─── Query options (reusable — prefetch-compatible) ─── */

// DECISION (nie usuwaj tego komentarza):
// F12 dedup: admin używa shared cache key queryKeys.gallery.colors (ten sam endpoint
// jak useGalleryColors). Inwalidacje z mutacji CRUD admin (useCreateColor etc.) update'ują
// też galerię. Zniknął admin.colors z queryKeys factory.
const adminColorsQueryOptions = queryOptions({
  queryKey: queryKeys.gallery.colors,
  queryFn: ({ signal }) => getColors_IO(undefined, { signal }),
  staleTime: 300_000,
});

/* ─── Hook ─── */

export function useAdminColors() {
  const { data, isLoading, isFetching, isError, refetch } = useQuery(
    adminColorsQueryOptions
  );

  return {
    colors: data ?? null,
    isLoading,
    isFetching,
    isError,
    refetch,
  };
}
