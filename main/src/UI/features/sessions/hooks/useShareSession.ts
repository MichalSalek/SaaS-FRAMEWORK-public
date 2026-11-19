// UI/features/sessions/hooks/useShareSession.ts
// TQ v5 mutation — POST share session container with stylist.
// Stack: TanStack Query v5.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { shareSessionContainer_IO } from '../../../../domain/session-container/sessionContainerIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { trackSessionFailed } from '../../shared/sessions/hooks/sessionFlowTrace';
import { trackFlowStep } from '../../../../application/analytics/flow-events';

/* --- Hook --- */

export function useShareSession(sessionId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => shareSessionContainer_IO({ session_id: sessionId }),
    meta: { suppressGlobalError: true },
    // DECISION: no local error toast, the HTTP interceptor owns it (three toast layers:
    // main/src/application/http/queryClient.config.ts). suppressGlobalError (layer 3 only) stays;
    // the success toast is silenced by success-feedback.policy.ts.
    onSuccess: () => {
      trackFlowStep('session', 'shared');
      // Prefix `all` pokrywa także byId(sessionId) — osobna inwalidacja była
      // podwójnym refetchem tego samego klucza.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.sessionContainer.all,
      });
      // First contact through a salon creates the pair in the share transaction.
      // Refresh existing readers so the conversation entry is available immediately.
      void queryClient.invalidateQueries({ queryKey: queryKeys.pairing.all });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.messaging.conversationsAll,
      });
    },
    onError: error => trackSessionFailed('share', error),
  });
}
