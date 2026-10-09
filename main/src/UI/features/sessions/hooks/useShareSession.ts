// UI/features/sessions/hooks/useShareSession.ts
// TQ v5 mutation — POST share session container with stylist.
// Stack: TanStack Query v5.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { shareSessionContainer_IO } from '../../../../domain/session-container/sessionContainerIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';

/* --- Hook --- */

export function useShareSession(sessionId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => shareSessionContainer_IO({ session_id: sessionId }),
    meta: { suppressGlobalError: true },
    // DECISION (nie usuwaj tego komentarza): ZERO lokalnego toasta success/error.
    // Warstwa 1 (HTTP interceptor) jest właścicielem — shareSessionContainer_IO nie
    // ustawia silentBusinessError, więc backendowy event (SESSION_CONTAINER_SHARED na
    // sukcesie / SESSION_CONTAINER_EMPTY / SHARE_QUOTA_EXCEEDED itd. na błędzie; żaden nie
    // jest w eventsDisallowedForUI) zawsze się toastuje. Lokalny t('shareSuccessToast')/
    // t('shareErrorToast') = inny string → Sonner id nie łapie → DWA toasty
    // (klasa S74/S75). suppressGlobalError gasi TYLKO warstwę 3 (MutationCache) — zostaje.
    onSuccess: () => {
      // Prefix `all` pokrywa także byId(sessionId) — osobna inwalidacja była
      // podwójnym refetchem tego samego klucza.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.sessionContainer.all,
      });
    },
  });
}
