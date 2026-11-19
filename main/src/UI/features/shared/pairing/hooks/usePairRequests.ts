import { syncConfirmedLifecycleActions } from '../../../../../domain/email/email-lifecycle-actions.analytics';
import type { PAIRING_DTO_API_V1 } from '@kernel/models/pairing/pairing.dto';
// Permanent QR code: connection request hooks.
// useRequestPair — the client from a public profile (invalidates accessStatus of
// THAT stylist so the profile at once shows „prośba wysłana”).
// usePendingRequests + useRespondPairRequest — the stylist on the Pairing screen
// (accept also invalidates the pair list: the new client appears at once).
// Stack: TQ v5, unified promise-first IO.

import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import {
  pairRequestCreate,
  pairRequestRespond,
  pairRequestCancel,
  pairingGetPendingRequests,
  pairingGetMyPendingRequests,
} from '../../../../../domain/pairing/pairingIO.possibilities.api';
import { queryKeys } from '../../../../../application/http/queryKeys.factory';
import { trackFlowStep } from '../../../../../application/analytics/flow-events';
import { flowErrorCode } from '../../analytics/flowErrorCode';

function invalidateConversation(
  queryClient: QueryClient,
  pairId: string | null | undefined
) {
  if (pairId) {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.messaging.thread(pairId),
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.messaging.conversationsAll,
    });
  }
}

export function useRequestPair(options?: { successFeedback: 'screen' }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { stylist_account_id: string; note?: string }) =>
      pairRequestCreate(input, options),
    // The error is toasted by layer 1 (HTTP interceptor: pairRequestCreate does not
    // set silentBusinessError); without suppress the global MutationCache.onError
    // would add a second, generic snackbar (contract: queryClient.config.ts).
    // Call sites (public profile, scanner) do NOT add their own toast.
    meta: { suppressGlobalError: true },
    onError: error => {
      trackFlowStep('pairing', 'request_failed', {
        action: 'send',
        code: flowErrorCode(error),
      });
    },
    onSuccess: (data, input) => {
      invalidateConversation(queryClient, data.pair_id);
      if (data.created) {
        trackFlowStep('pairing', 'request_sent');
      }
      void queryClient.invalidateQueries({
        queryKey: queryKeys.pairing.accessStatus(input.stylist_account_id),
      });
      // The client's waiting list (her dashboard) gains this request.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.pairing.myPendingRequests,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.pairing.pairs,
      });
    },
  });
}

// The client withdraws her own PENDING request: invalidates accessStatus of THAT
// stylist (the profile returns to the „Wyślij prośbę” button).
export function useCancelPairRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { stylist_account_id: string }) =>
      pairRequestCancel(input),
    meta: { suppressGlobalError: true },
    onSuccess: (data, input) => {
      const accessKey = queryKeys.pairing.accessStatus(
        input.stylist_account_id
      );
      const previousAccess =
        queryClient.getQueryData<
          PAIRING_DTO_API_V1['PAIRING_GET_ACCESS_STATUS']['RESPONSE']
        >(accessKey);
      if (data.success) {
        trackFlowStep('pairing', 'request_cancelled');
      }
      invalidateConversation(queryClient, previousAccess?.pair_id);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.pairing.myPendingRequests,
      });
      void queryClient.invalidateQueries({
        queryKey: accessKey,
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
    // A request sent from the client's phone must appear on the OPEN Pairing
    // screen without a reload: a light poll; the STRICT limit (50/10s per IP)
    // will not feel it.
    refetchInterval: intervalMs,
  });

// intervalMs (default 30s): the Pairing screen wants „live” freshness (a new
// request appears without a reload). The global consumer (the bell in AppLayout,
// mounted on EVERY stylist page) passes a gentler interval so it does not hit
// the server/battery every 30s all session: the badge need not be fresh to the second.
export function usePendingRequests(enabled: boolean, intervalMs = 30_000) {
  return useQuery(pendingRequestsQueryOptions(enabled, intervalMs));
}

// The client's own requests still waiting for the stylist (dashboard).
// Polled gently: an accept shows up on the open dashboard without a reload.
export function useMyPendingRequests(enabled: boolean) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.pairing.myPendingRequests,
    queryFn: async ({ signal }) => {
      const latest = await pairingGetMyPendingRequests(undefined, { signal });
      const previous = queryClient.getQueryData<
        PAIRING_DTO_API_V1['PAIRING_GET_MY_PENDING_REQUESTS']['RESPONSE']
      >(queryKeys.pairing.myPendingRequests);
      const pendingIds = new Set(
        latest.requests.map(request => request.pair_id)
      );
      const removed = previous?.requests.filter(
        request => !pendingIds.has(request.pair_id)
      );
      // Disappearance can mean acceptance, refusal or cancellation. Read the authoritative
      // pair/access data instead of inferring an outcome. Test: usePairRequests.test.ts.
      if (!signal.aborted && removed && removed.length > 0) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.pairing.pairs,
        });
        for (const request of removed) {
          void queryClient.invalidateQueries({
            queryKey: queryKeys.pairing.accessStatus(
              request.stylist_account_id
            ),
          });
        }
      }
      return latest;
    },
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useRespondPairRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { pair_id: string; action: 'ACCEPT' | 'DECLINE' }) =>
      pairRequestRespond(
        input,
        input.action === 'ACCEPT' ? { silentBusinessError: true } : undefined
      ),
    // ACCEPT owns business 4xx feedback so a plan-cap response can open the shared
    // upgrade dialog; transport and server errors keep the interceptor feedback.
    meta: { suppressGlobalError: true },
    onError: (error, input) => {
      trackFlowStep('pairing', 'request_failed', {
        action: input.action === 'ACCEPT' ? 'accept' : 'decline',
        code: flowErrorCode(error),
      });
    },
    onSuccess: (_data, input) => {
      invalidateConversation(queryClient, input.pair_id);
      if (input.action === 'ACCEPT') {
        void syncConfirmedLifecycleActions(true);
      } else {
        trackFlowStep('pairing', 'request_declined');
      }
      void queryClient.invalidateQueries({
        queryKey: queryKeys.pairing.pendingRequests,
      });
      // ACCEPT adds an ACTIVE pair: the client list, the dashboard feed and the
      // client-limit bar (usage stats, 60s stale) must be recomputed (stale
      // counters after an accept).
      void queryClient.invalidateQueries({
        queryKey: queryKeys.pairing.pairs,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.account.dashboardFeed,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.account.usageStats,
      });
      // The answer closes the stylist's own notification (server-side).
      void queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.all,
      });
    },
  });
}
