// UI/features/shared/pairing/hooks/usePairedStylists.ts
// Client-perspective view over the paired list: maps the raw pairs DTO union
// to a camelCase stylist shape for the client dashboard / sessions screens.

import { useMemo } from 'react';
import { usePairedList } from './usePairedList';
import {
  isPairedStylist,
  type PairedStylist,
} from '../../../../../domain/pairing/pairing.types';
import type { PAIRING_DTO_API_V1 } from '@kernel/models/pairing/pairing.dto';

/* --- Types --- */

type PairRow =
  PAIRING_DTO_API_V1['PAIRING_GET_MY_PAIRS']['RESPONSE']['pairs'][number];

// View-model shape (camelCase) consumed by the client dashboard + sessions.
// Distinct from the raw DTO type `PairedStylist` in domain/pairing/pairing.types.
export interface PairedStylistView {
  stylistAccountId: string;
  stylistDisplayName: string;
  pairedAt: string;
  isInactive: boolean;
}

export function mapPairedStylistViews(
  rawPairs: readonly PairRow[]
): PairedStylistView[] {
  return rawPairs.filter(isPairedStylist).map((p: PairedStylist) => ({
    stylistAccountId: p.account_id,
    stylistDisplayName: p.display_name ?? '',
    pairedAt: p.paired_at,
    isInactive: p.counterpart_inactive,
  }));
}

/* --- Hook --- */

// DECISION (nie usuwaj):
// Konsolidacja 2 wcześniejszych wrapperów nad pairingGetMyPairs (usePairedList +
// dashboard/components/hooks/useClientPairs.usePairedStylists). pairing = owner
// pairs-concern: cała logika fetch/query (queryKey, take:50, staleTime, cursor
// pagination) żyje w usePairedList. Ten hook to CIENKI wrapper — wyłącznie
// post-fetch shape mapping (raw pairs union -> camelCase PairedStylistView).
export function usePairedStylists() {
  const { pairs: rawPairs, ...query } = usePairedList();

  const pairs = useMemo<PairedStylistView[]>(
    () => mapPairedStylistViews(rawPairs),
    [rawPairs]
  );

  return {
    pairs,
    isLoading: query.isLoading,
    isError: query.isError,
    // isError alone cannot tell „no list yet" from „stale list, refetch failed"
    // (TQ v5 keeps data on a failed refetch) — callers gate their error UI on it.
    hasData: query.data !== undefined,
    isFetching: query.isFetching,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch,
  };
}
