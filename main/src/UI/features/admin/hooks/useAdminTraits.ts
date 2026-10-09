// main/src/UI/features/admin/hooks/useAdminTraits.ts
// TQ v5 query — GET /api/v1/gallery/traits (list of traits for admin management).
// Stack: TQ v5 queryOptions.

import { queryOptions, useQuery } from '@tanstack/react-query';
import { getTraits_IO } from '../../../../domain/gallery/galleryIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';

/* ─── Types ─── */

type AdminTraitsResponse = GALLERY_DTO_API_V1['GET_TRAITS']['RESPONSE'];
export type AdminTrait = AdminTraitsResponse[number];

/* ─── Query options (reusable — prefetch-compatible) ─── */

// DECISION (nie usuwaj tego komentarza):
// F12 dedup: admin używa shared cache key queryKeys.gallery.traits (ten sam endpoint
// jak useGalleryTraits). Inwalidacje z mutacji CRUD admin (useCreateTrait etc.) update'ują
// też galerię. Zniknął admin.traits z queryKeys factory.
const adminTraitsQueryOptions = queryOptions({
  queryKey: queryKeys.gallery.traits,
  queryFn: ({ signal }) => getTraits_IO({}, { signal }),
  staleTime: 300_000,
});

/* ─── Hook ─── */

export function useAdminTraits() {
  const { data, isLoading, isFetching, isError, refetch } = useQuery(
    adminTraitsQueryOptions
  );

  return {
    traits: data ?? null,
    isLoading,
    isFetching,
    isError,
    refetch,
  };
}
