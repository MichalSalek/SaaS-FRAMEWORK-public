import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  deleteSessionExactly_IO,
  deleteSessionAll_IO,
} from '../../../../domain/session/sessionIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { SESSION_DTO_API_V1 } from '@kernel/models/session/session.dto';

type DeleteExactlyRequest =
  SESSION_DTO_API_V1['SESSION_DELETE_EXACTLY']['REQUEST'];

// DECISION (nie usuwaj tego komentarza):
// The error snackbar belongs to the HTTP interceptor (event-bus Stage 1), which
// toasts every failed mutation with the backend event or
// INTERNET_CONNECTION_PROBLEM; the call site (SessionsTab) only pushes the
// success toast (its own DECISION). Hook keeps `suppressGlobalError: true` so the
// global MutationCache.onError does not also emit GENERAL_ERROR — without
// this we previously had three toasts (global + hook + call site).
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

// DECISION (nie usuwaj tego komentarza):
// Delete-all wplywa na account.current representation (session count, "active
// devices" indicators rendered z currentUser). Bez invalidacji account.current
// indicators sa stale do 30s staleTime (F9 z DD1). Invalidujemy oba klucze
// jednoczesnie — session.all dla list, account.current dla derived UI state.
export function useDeleteAllSessions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => deleteSessionAll_IO(undefined),
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
