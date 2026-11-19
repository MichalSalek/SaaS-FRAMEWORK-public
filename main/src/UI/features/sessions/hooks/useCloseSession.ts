// UI/features/sessions/hooks/useCloseSession.ts
// TQ v5 mutation — POST close session container.
// Stack: TanStack Query v5.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/router';
import { closeSessionContainer_IO } from '../../../../domain/session-container/sessionContainerIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { trackSessionFailed } from '../../shared/sessions/hooks/sessionFlowTrace';
import { trackFlowStep } from '../../../../application/analytics/flow-events';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';

/* --- Hook --- */

/**
 * `redirectTo`: the list the closer returns to. The client goes back to her
 * sessions; the stylist (who closes after the visit) to the sessions she
 * received, where this one no longer stands.
 */
export function useCloseSession(
  redirectTo: string = ROUTES_FRONT.CLIENT_SESSIONS,
  role: 'client' | 'stylist' = 'client'
) {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: (sessionId: string) =>
      closeSessionContainer_IO({ session_id: sessionId }),
    meta: { suppressGlobalError: true },
    // DECISION: no local error toast, the HTTP interceptor owns it (three toast layers:
    // main/src/application/http/queryClient.config.ts). suppressGlobalError (layer 3 only) stays.
    onSuccess: () => {
      trackFlowStep('session', 'closed', { role });
      void router.push(redirectTo);
    },
    onError: error => trackSessionFailed('close', error),
    // Invalidate in onSettled (fires on success AND error) so the session list
    // refreshes regardless of outcome, and the cache bust is not racing the
    // success-path redirect. Mirrors sibling mutations (useRevokePairingCode).
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.sessionContainer.all,
      });
    },
  });
}
