// UI/features/sessions/hooks/useCloseSession.ts
// TQ v5 mutation — POST close session container.
// Stack: TanStack Query v5.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/router';
import { closeSessionContainer_IO } from '../../../../domain/session-container/sessionContainerIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';

/* --- Hook --- */

export function useCloseSession() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: (sessionId: string) =>
      closeSessionContainer_IO({ session_id: sessionId }),
    meta: { suppressGlobalError: true },
    // DECISION (nie usuwaj tego komentarza): ZERO lokalnego toasta success/error.
    // Kontrakt 3-warstwowy (queryClient.config.ts): warstwa 1 (HTTP interceptor) JEST
    // właścicielem toasta. closeSessionContainer_IO nie ustawia silentBusinessError,
    // więc interceptor zawsze toastuje event backendu (SESSION_CONTAINER_CLOSED na
    // sukcesie / SESSION_CONTAINER_NOT_AUTHORIZED itd. na błędzie — żaden nie jest w
    // eventsDisallowedForUI). Lokalny t('closeSuccessToast')/t('closeErrorToast') = inny
    // string niż event-key → Sonner id nie łapie → DWA toasty (klasa S74/S75,
    // wzorzec useUnpair). suppressGlobalError gasi TYLKO warstwę 3 (MutationCache) — zostaje.
    onSuccess: () => {
      void router.push(ROUTES_FRONT.CLIENT_SESSIONS);
    },
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
