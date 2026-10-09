// Stały kod QR (2026-07-11): hooki prośby o połączenie.
// useRequestPair — klientka z publicznego profilu (invaliduje accessStatus
// TEJ stylistki, żeby profil od razu pokazał „prośba wysłana").
// usePendingRequests + useRespondPairRequest — stylistka na ekranie
// Parowanie (accept invaliduje też listę par: nowa klientka pojawia się od
// razu). Stack: TQ v5, unified promise-first IO (FDX W2.2).

import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  pairRequestCreate,
  pairRequestRespond,
  pairRequestCancel,
  pairingGetPendingRequests,
} from '../../../../../domain/pairing/pairingIO.possibilities.api';
import { queryKeys } from '../../../../../application/http/queryKeys.factory';

export function useRequestPair() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { stylist_account_id: string }) =>
      pairRequestCreate(input),
    // Błąd toastuje warstwa 1 (HTTP interceptor: pairRequestCreate nie ustawia
    // silentBusinessError) — bez suppress globalny MutationCache.onError
    // dokładałby drugi, generyczny snackbar (kontrakt: queryClient.config.ts).
    // Call-site'y (profil publiczny, skaner) NIE dokładają własnego toasta.
    meta: { suppressGlobalError: true },
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.pairing.accessStatus(input.stylist_account_id),
      });
      // Lista połączeń klientki pokazuje też pary PENDING, a prośba wysłana ze
      // skanera wraca prosto na ten ekran — bez tego nowa pozycja pojawiała się
      // dopiero po ręcznym odświeżeniu.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.pairing.pairs,
      });
    },
  });
}

// O1: klientka wycofuje własną prośbę PENDING — invaliduje accessStatus TEJ
// stylistki (profil wraca do przycisku „Wyślij prośbę").
export function useCancelPairRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { stylist_account_id: string }) =>
      pairRequestCancel(input),
    meta: { suppressGlobalError: true },
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.pairing.accessStatus(input.stylist_account_id),
      });
    },
  });
}

const pendingRequestsQueryOptions = (enabled: boolean, intervalMs: number) =>
  queryOptions({
    queryKey: queryKeys.pairing.pendingRequests,
    queryFn: ({ signal }) => pairingGetPendingRequests(undefined, { signal }),
    enabled,
    staleTime: 30_000,
    // Prośba wysłana z telefonu klientki ma pojawić się na OTWARTYM ekranie
    // Parowanie bez reloadu (Codex #6) — lekki poll; STRICT (50/10s per IP)
    // tego nie odczuje.
    refetchInterval: intervalMs,
  });

// intervalMs (domyślnie 30s): ekran Parowanie chce świeżości „na żywo" (nowa
// prośba pojawia się bez reloadu). Konsument globalny (dzwoneczek w AppLayout,
// montowany na KAŻDEJ stronie stylistki) podaje łagodniejszy interwał, żeby nie
// bić serwera/baterii co 30s przez całą sesję — badge nie musi być sekundowo świeży.
export function usePendingRequests(enabled: boolean, intervalMs = 30_000) {
  return useQuery(pendingRequestsQueryOptions(enabled, intervalMs));
}

export function useRespondPairRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { pair_id: string; action: 'ACCEPT' | 'DECLINE' }) =>
      pairRequestRespond(input),
    // Błąd toastuje interceptor (patrz DECISION w StylistPairRequests) —
    // suppress jak wyżej (anty-double-snackbar).
    meta: { suppressGlobalError: true },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.pairing.pendingRequests,
      });
      // ACCEPT dokłada ACTIVE parę — lista klientek, feed dashboardu i pasek
      // limitu klientek (usage stats, 60s stale) muszą się przeliczyć
      // (Codex #7: stare liczniki po akceptacji).
      void queryClient.invalidateQueries({
        queryKey: queryKeys.pairing.pairs,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.account.dashboardFeed,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.account.usageStats,
      });
    },
  });
}
