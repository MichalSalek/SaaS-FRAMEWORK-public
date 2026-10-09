// UI/features/account/hooks/useReactivateAccount.ts
// ADRR Model A (§13.1) — TQ v5 mutation for POST /api/v1/user/reactivate.
// Reactivates the current user's soft-deleted (RECOVERABLE) account in-place.
// On success the account flips back to ACTIVE; we invalidate the current-user
// query so the app shell (AppLayout recovery guard) re-reads ACTIVE state and
// stops redirecting to the restore screen — the user lands back in the app.
// Stack: TanStack Query v5.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { reactivateAccount_IO } from '../../../../domain/user/userIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';

/* ─── Types ─── */

export type ReactivateAccountResponse =
  USER_DTO_API_V1['USER_REACTIVATE_ACCOUNT']['RESPONSE'];

/* ─── Hook ─── */

export function useReactivateAccount() {
  const queryClient = useQueryClient();

  return useMutation<ReactivateAccountResponse, Error, void>({
    mutationFn: () => reactivateAccount_IO({}),
    // Caller owns the success/error snackbar so the global fallback is suppressed
    // to avoid duplicate toasts.
    meta: { suppressGlobalError: true },

    onSuccess: () => {
      // Re-read the current user → state recomputes to ACTIVE → guard releases.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.account.current,
      });
    },
  });
}
