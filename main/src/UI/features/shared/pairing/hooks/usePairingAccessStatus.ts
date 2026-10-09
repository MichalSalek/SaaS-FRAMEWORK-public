import { queryOptions, useQuery } from '@tanstack/react-query';
import { pairingGetAccessStatus } from '../../../../../domain/pairing/pairingIO.possibilities.api';
import { queryKeys } from '../../../../../application/http/queryKeys.factory';

const accessStatusQueryOptions = (stylistAccountId: string, enabled: boolean) =>
  queryOptions({
    queryKey: queryKeys.pairing.accessStatus(stylistAccountId),
    queryFn: ({ signal }) =>
      pairingGetAccessStatus(
        { stylist_account_id: stylistAccountId },
        { signal }
      ),
    enabled: enabled && stylistAccountId.length > 0,
    staleTime: 60_000,
    // Klientka czeka na profilu z badge „prośba wysłana" — akceptacja
    // stylistki na innym urządzeniu ma wejść bez reloadu (Codex #6): poll
    // TYLKO w stanie PENDING, wygasa sam po przejściu na PAIRED/PUBLIC.
    refetchInterval: query =>
      query.state.data?.access === 'PENDING' ? 30_000 : false,
  });

export function usePairingAccessStatus(
  stylistAccountId: string,
  enabled: boolean
) {
  const query = useQuery(accessStatusQueryOptions(stylistAccountId, enabled));

  return {
    isPaired: query.data?.access === 'PAIRED',
    // Stały kod QR (2026-07-11): prośba klientki czeka na akceptację —
    // profil pokazuje stan zamiast ponownego przycisku prośby.
    isPendingRequest: query.data?.access === 'PENDING',
    // O1: id pary (PENDING/PAIRED) — klucz dla „anuluj prośbę" + wejścia do
    // komunikatora z profilu. null przy PUBLIC.
    pairId: query.data?.pair_id ?? null,
    isLoading: query.isLoading && enabled,
    isChecked: query.isSuccess || query.isError || !enabled,
    // The check failed with no earlier answer, so the PUBLIC fallback above is
    // a guess (a paired client would see the pinned portfolio and a pair CTA).
    // A background read, so no global toast: callers that branch on the pair
    // state say it themselves.
    checkFailed: enabled && query.isError && query.data === undefined,
    isFetching: query.isFetching,
    refetch: query.refetch,
  };
}
