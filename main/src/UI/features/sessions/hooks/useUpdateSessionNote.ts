// UI/features/sessions/hooks/useUpdateSessionNote.ts
// TQ v5 mutation — POST /api/v1/session-container/set-note
// Saves the stylist's private note on a session, then invalidates the detail query.
// Stack: TanStack Query v5.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setSessionContainerNote_IO } from '../../../../domain/session-container/sessionContainerIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { trackSessionFailed } from '../../shared/sessions/hooks/sessionFlowTrace';
import { trackFlowStep } from '../../../../application/analytics/flow-events';

/* --- Hook --- */

/** `side` is re-derived and enforced by the backend; it only states intent. */
export function useUpdateSessionNote(
  sessionId: string,
  side: 'stylist' | 'client' = 'stylist'
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (note: string) =>
      setSessionContainerNote_IO({
        session_id: sessionId,
        note,
        side,
      }),
    meta: { suppressGlobalError: true },
    // DECISION: no local error toast, the HTTP interceptor owns it (three toast layers:
    // main/src/application/http/queryClient.config.ts). suppressGlobalError (layer 3 only) stays;
    // the success toast is silenced by success-feedback.policy.ts.
    onSuccess: () => trackFlowStep('session', 'note_saved', { role: side }),
    onError: error => trackSessionFailed('note', error),
    onSettled: () => {
      // Invalidate the WHOLE container prefix, not just byId(sessionId). The note
      // preview/count surfaces in the list views too (sessionContainer.my +
      // myAsStylist), which the byId-only invalidation left stale. The `all`
      // prefix covers my + myAsStylist + byId in one shot — same pattern as
      // useCreateSession / useCloseSession.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.sessionContainer.all,
      });
    },
  });
}
