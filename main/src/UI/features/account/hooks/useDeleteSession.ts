import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  deleteSessionExactly_IO,
  deleteSessionAll_IO,
} from '../../../../domain/session/sessionIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { SESSION_DTO_API_V1 } from '@kernel/models/session/session.dto';

type DeleteExactlyRequest =
  SESSION_DTO_API_V1['SESSION_DELETE_EXACTLY']['REQUEST'];

// DECISION: the error snackbar belongs to the HTTP interceptor (event-bus Stage 1); the call site
// (SessionsTab) only pushes the success toast. The hook keeps `suppressGlobalError: true` so the
// global MutationCache.onError does not also emit GENERAL_ERROR (previously three toasts: global +
// hook + call site).
export function useDeleteSessionExactly() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: DeleteExactlyRequest) => deleteSessionExactly_IO(req),
    meta: { suppressGlobalError: true },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.session.all,
      });
    },
  });
}

// DECISION: delete-all affects the account.current representation (session count, "active devices"
// indicators rendered from currentUser); without invalidating account.current those indicators are
// stale for the 30s staleTime. Both keys are invalidated together: session.all for the list,
// account.current for derived UI state.
export function useDeleteAllSessions() {
  const queryClient = useQueryClient();

  return useMutation({
    // One success owner: SessionsTab says „every device” (successFeedback, io.ts).
    mutationFn: () => deleteSessionAll_IO({}, { successFeedback: 'screen' }),
    meta: { suppressGlobalError: true },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.session.all,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.account.current,
      });
    },
  });
}
