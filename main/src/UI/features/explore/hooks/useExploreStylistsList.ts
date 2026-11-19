import { useInfiniteQuery } from '@tanstack/react-query';
import type { InfiniteData, QueryKey } from '@tanstack/react-query';
import { getPublicStylistsList_IO } from '../../../../domain/public/publicIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { PUBLIC_DTO_API_V1 } from '@kernel/models/public/public.dto';

type StylistsResponse =
  PUBLIC_DTO_API_V1['GET_PUBLIC_STYLISTS_LIST']['RESPONSE'];

type StylistListQuery = {
  cursor?: string;
  take?: number;
  city?: string;
  searchQuery?: string;
};

function buildKeyParams(filters: {
  city: string | undefined;
  searchQuery: string | undefined;
}): StylistListQuery {
  const params: StylistListQuery = {};
  if (filters.city) {
    params.city = filters.city;
  }
  if (filters.searchQuery) {
    params.searchQuery = filters.searchQuery;
  }
  return params;
}

export function useExploreStylistsList(filters: {
  city: string | undefined;
  searchQuery: string | undefined;
}) {
  const keyParams = buildKeyParams(filters);

  return useInfiniteQuery<
    StylistsResponse,
    Error,
    InfiniteData<StylistsResponse>,
    QueryKey,
    string | undefined
  >({
    queryKey: queryKeys.public.stylistsList(keyParams),
    queryFn: ({ pageParam, signal }) => {
      const req: StylistListQuery = { take: 20 };
      if (filters.city) {
        req.city = filters.city;
      }
      if (filters.searchQuery) {
        req.searchQuery = filters.searchQuery;
      }
      if (pageParam != null) {
        req.cursor = pageParam;
      }
      return getPublicStylistsList_IO(req, { signal });
    },
    getNextPageParam: lastPage => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined,
    staleTime: 2 * 60_000,
  });
}
