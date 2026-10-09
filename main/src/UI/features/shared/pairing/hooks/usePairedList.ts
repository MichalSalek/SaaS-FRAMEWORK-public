// UI/features/shared/pairing/hooks/usePairedList.ts
// TQ v5 useInfiniteQuery — cursor-based pagination for /api/v1/pairing/get-my-pairs
// Stack: TanStack Query v5.

import { useEffect, useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { InfiniteData, QueryKey } from '@tanstack/react-query';
import { pairingGetMyPairs } from '../../../../../domain/pairing/pairingIO.possibilities.api';
import { queryKeys } from '../../../../../application/http/queryKeys.factory';
import type { PAIRING_DTO_API_V1 } from '@kernel/models/pairing/pairing.dto';

/* --- Types --- */

export type PairsResponse =
  PAIRING_DTO_API_V1['PAIRING_GET_MY_PAIRS']['RESPONSE'];

/* --- Flatten helper --- */

function flattenPairedPages(
  data: InfiniteData<PairsResponse> | undefined
): PairsResponse['pairs'] {
  return data?.pages.flatMap(p => p.pairs) ?? [];
}

/* --- Hook --- */

export function usePairedList() {
  const query = useInfiniteQuery<
    PairsResponse,
    Error,
    InfiniteData<PairsResponse>,
    QueryKey,
    string | undefined
  >({
    queryKey: queryKeys.pairing.pairs,
    queryFn: ({ pageParam, signal }) => {
      // Build the request without an unsafe cast: REQUEST is
      // `{ cursor?: string; take?: number } | undefined`, so `Exclude<…,
      // undefined>` is the defined-object shape we assemble here. `cursor` is
      // only set when a pageParam exists (first page = undefined cursor).
      const req: Exclude<
        PAIRING_DTO_API_V1['PAIRING_GET_MY_PAIRS']['REQUEST'],
        undefined
      > = pageParam != null ? { take: 50, cursor: pageParam } : { take: 50 };
      return pairingGetMyPairs(req, { signal });
    },
    getNextPageParam: lastPage => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined,
    staleTime: 60_000,
  });

  // DECISION (nie usuwaj tego komentarza): strony dociągane ZACHŁANNIE do końca.
  // Poza ClientPairingOrganism (sentinel infinite-scroll na /app/pairing) żaden
  // konsument nie woła fetchNextPage, a `pairs` służy im jako KOMPLET (lista
  // klientek stylistki, liczniki dashboardu, lookup nazwy stylistki w
  // sesji/profilu klientki) — z jedną stroną po 50 stylistka Pro
  // z 51. klientką nigdy jej nie widziała, a sesja z taką klientką dostawała
  // fallback nazwy. Zbiór jest ograniczony parami jednego konta.
  // Stop przy błędzie strony (inaczej efekt zapętla retry po każdym padzie).
  const {
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  } = query;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  // Memoize on query.data (stable via TQ v5 structural sharing) — bez tego
  // flattenPairedPages alokuje NOWĄ tablicę co render, co defeatuje useMemo
  // konsumentów (usePairedStylists.filter/map, ClientSessionsPage) i wymusza
  // zbędne re-recompute/re-render w dół drzewa.
  const pairs = useMemo(() => flattenPairedPages(query.data), [query.data]);

  return {
    ...query,
    pairs,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
