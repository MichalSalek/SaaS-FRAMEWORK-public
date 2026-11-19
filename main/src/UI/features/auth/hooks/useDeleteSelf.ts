// UI/features/auth/hooks/useDeleteSelf.ts
// TQ v5 mutation — POST /api/v1/user/delete/self
// Sends a confirmation email; the caller shows a "check your inbox" screen.
// Stack: TanStack Query v5 + unified io.ts front-door (promise-first).

import { useMutation } from '@tanstack/react-query';
import { deleteUserSelf_IO } from '../../../../domain/user/userIO.possibilities.api';
import { trackFlowStep } from '../../../../application/analytics/flow-events';
import { flowErrorCode } from '../../shared/analytics/flowErrorCode';

// Brak onSuccess-redirectu: backend odpowiada USER_DELETE_REQUESTED (flow
// z potwierdzeniem mailem), a przejście na krok „sprawdź skrzynkę" robi strona.
export function useDeleteSelf() {
  return useMutation({
    mutationFn: () => deleteUserSelf_IO({}),
    meta: { suppressGlobalError: true },
    onSuccess: () => trackFlowStep('account', 'deletion_requested'),
    onError: error =>
      trackFlowStep('account', 'failed', {
        action: 'deletion_request',
        code: flowErrorCode(error),
      }),
  });
}
