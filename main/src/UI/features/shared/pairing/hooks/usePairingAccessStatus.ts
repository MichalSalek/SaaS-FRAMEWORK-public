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
    // The client waits on the profile with a „request sent” badge: the stylist's
    // acceptance on another device must arrive without a reload: poll ONLY in the
    // PENDING state, it stops by itself after moving to PAIRED/PUBLIC.
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
    // Permanent QR code: the client's request awaits acceptance, so the
    // profile shows the state instead of the request button again.
    isPendingRequest: query.data?.access === 'PENDING',
    // Pair id (PENDING/PAIRED): the key for „cancel request” + entry to the
    // messenger from the profile. null for PUBLIC.
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
