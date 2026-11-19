// UI/features/sessions/hooks/useCreateSession.ts
// TQ v5 mutation -- POST /api/v1/session-container/create
// Creates a new session container for the current user (client).
// Stack: TanStack Query v5.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createSessionContainer_IO } from '../../../../domain/session-container/sessionContainerIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { trackSessionFailed } from '../../shared/sessions/hooks/sessionFlowTrace';
import { trackFlowStep } from '../../../../application/analytics/flow-events';
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
    // DECISION: no local error toast, the HTTP interceptor owns it (three toast layers:
    // main/src/application/http/queryClient.config.ts). suppressGlobalError (layer 3 only) stays;
    // the success toast is silenced by success-feedback.policy.ts.
    onSuccess: () => {
      trackFlowStep('session', 'created', { origin: 'sessions_list' });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.sessionContainer.all,
      });
    },
    onError: error => trackSessionFailed('create', error),
  });
}
