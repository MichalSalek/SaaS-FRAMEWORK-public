// UI/features/sessions/hooks/useUpdateSessionNote.ts
// TQ v5 mutation — POST /api/v1/session-container/set-note
// Saves the stylist's private note on a session, then invalidates the detail query.
// Stack: TanStack Query v5.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setSessionContainerNote_IO } from '../../../../domain/session-container/sessionContainerIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';

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
    // DECISION (nie usuwaj tego komentarza): ZERO lokalnego onError-toasta. Warstwa 1
    // (HTTP interceptor) jest właścicielem — setSessionContainerNote_IO nie ustawia
    // silentBusinessError, więc backendowy event błędu (SESSION_CONTAINER_INVALID_STATE /
    // NOT_AUTHORIZED itd.) zawsze się toastuje; lokalny t('noteSaveError') = inny string →
    // dedup nie łapie → double (klasa S74/S75). Sukces należy do interceptora
    // (SESSION_CONTAINER_NOTE_UPDATED, nie disallowed) — hook nigdy nie miał lokalnego
    // success-toasta. suppressGlobalError gasi TYLKO warstwę 3 (MutationCache) — zostaje.
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
