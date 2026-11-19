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
  /** Present only for a real accepted pair, not an unpaired salon member. */
  pairId?: string;
  stylistAccountId: string;
  stylistDisplayName: string;
  pairedAt: string;
  isInactive: boolean;
  avatarUrl?: string | null;
  salonName?: string;
  /** Reached through a salon (salon-derived pairing or salon member without
   *  one yet): outside the shared-session limit. */
  viaSalon: boolean;
}

export function mapPairedStylistViews(
  rawPairs: readonly PairRow[]
): PairedStylistView[] {
  return rawPairs.filter(isPairedStylist).map((p: PairedStylist) => ({
    pairId: p.id,
    stylistAccountId: p.account_id,
    // `||`: an empty name (role-only onboarding) falls through to the business
    // name; '' stays the "no name" sentinel every consumer falls back on.
    stylistDisplayName: p.display_name || p.business_name || '',
    pairedAt: p.paired_at,
    isInactive: p.counterpart_inactive,
    avatarUrl: p.avatar_url,
    viaSalon: p.salon_origin_account_id != null,
  }));
}

/* --- Hook --- */

// Thin wrapper: fetch/query config (queryKey, take, staleTime, cursor) lives in usePairedList;
// this hook maps pairs to PairedStylistView and adds salon team members not paired directly.
export function usePairedStylists() {
  const { pairs: rawPairs, ...query } = usePairedList();

  const pairs = useMemo<PairedStylistView[]>(() => {
    const mapped = mapPairedStylistViews(rawPairs);
    const seen = new Set(mapped.map(person => person.stylistAccountId));
    for (const salon of query.data?.pages[0]?.salons ?? []) {
      for (const member of salon.members) {
        if (!seen.has(member.account_id)) {
          mapped.push({
            stylistAccountId: member.account_id,
            stylistDisplayName: member.name,
            pairedAt: '',
            isInactive: false,
            avatarUrl: member.avatar_url,
            salonName: salon.name,
            viaSalon: true,
          });
          seen.add(member.account_id);
        }
      }
    }
    return mapped;
  }, [rawPairs, query.data]);

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
