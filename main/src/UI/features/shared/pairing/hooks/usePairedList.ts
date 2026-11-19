// UI/features/shared/pairing/hooks/usePairedList.ts
// TQ v5 useInfiniteQuery — cursor-based pagination for /api/v1/pairing/get-my-pairs
// Stack: TanStack Query v5.

import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { InfiniteData, QueryKey } from '@tanstack/react-query';
import { pairingGetMyPairs } from '../../../../../domain/pairing/pairingIO.possibilities.api';
import { useFetchRemainingPages } from '../../gallery/hooks/useFetchRemainingPages';
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

  // DECISION: pages are fetched EAGERLY to the end. Only ClientPairingOrganism scrolls for more;
  // every other consumer treats `pairs` as the COMPLETE set (the stylist's client list, dashboard
  // counts, name lookup in sessions), so with one 50-row page client no. 51 never appeared. The
  // set is bounded by one account's pairs. Stops on a failed page, or the effect loops the retry.
  useFetchRemainingPages(true, query);

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
