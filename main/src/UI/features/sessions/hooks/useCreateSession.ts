// UI/features/sessions/hooks/useCreateSession.ts
// TQ v5 mutation -- POST /api/v1/session-container/create
// Creates a new session container for the current user (client).
// Stack: TanStack Query v5.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createSessionContainer_IO } from '../../../../domain/session-container/sessionContainerIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { SESSION_CONTAINER_DTO_API_V1 } from '@kernel/models/session-container/session-container.dto';

/* --- Types --- */

type CreateSessionRequest =
  SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_CREATE']['REQUEST'];

type CreateSessionResponse =
  SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_CREATE']['RESPONSE'];

/* --- Hook --- */

export function useCreateSession() {
  const queryClient = useQueryClient();

  return useMutation<CreateSessionResponse, Error, CreateSessionRequest>({
    mutationFn: (req: CreateSessionRequest) => createSessionContainer_IO(req),
    meta: { suppressGlobalError: true },
    // DECISION (nie usuwaj tego komentarza): ZERO lokalnego onError-toasta. Warstwa 1
    // (HTTP interceptor) jest właścicielem — createSessionContainer_IO nie ustawia
    // silentBusinessError, więc backendowy event błędu (SESSION_CONTAINER_MAX_ACTIVE_EXCEEDED
    // / NOT_PAIRED itd.) zawsze się toastuje; lokalny t('createErrorToast') = inny string →
    // dedup nie łapie → double (klasa S74/S75). Sukces też należy do interceptora
    // (SESSION_CONTAINER_CREATED, nie disallowed) — hook nigdy nie miał lokalnego success-
    // toasta. suppressGlobalError gasi TYLKO warstwę 3 (MutationCache) — zostaje.
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.sessionContainer.all,
      });
    },
  });
}
