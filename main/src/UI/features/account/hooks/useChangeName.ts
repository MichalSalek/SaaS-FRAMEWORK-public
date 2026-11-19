// UI/features/account/hooks/useChangeName.ts
// TQ v5 mutation -- POST /api/v1/user/change-name
// Updates the user's display name. Invalidates the current-user query so
// dependent UI re-renders with the fresh value.
// Stack: TanStack Query v5 + unified io.ts front-door (promise-first).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { changeUserName_IO } from '../../../../domain/user/userIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { setCurrentUser } from '../../../../application/stores/user-cache';
import { invalidateStylistProfileCaches } from '../../shared/profile/invalidate-stylist-profile.helper';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';
import type { SafeCurrentUser } from '@kernel/models/session/session.dto';

/* ─── Types ─── */

type ChangeNameRequest = USER_DTO_API_V1['USER_CHANGE_NAME']['REQUEST'];
type ChangeNameResponse = USER_DTO_API_V1['USER_CHANGE_NAME']['RESPONSE'];

/* ─── Hook ─── */

export function useChangeName(options?: { successFeedback: 'silent' }) {
  const queryClient = useQueryClient();

  return useMutation<ChangeNameResponse, Error, ChangeNameRequest>({
    mutationFn: req =>
      options ? changeUserName_IO(req, options) : changeUserName_IO(req),
    meta: { suppressGlobalError: true },
    onSuccess: data => {
      // Cache patch lives in this hook, not in the IO layer.
      // Patch the cached current-user with the new display name so any UI
      // consumer reading queryKeys.account.current sees the update without
      // waiting for the next refetch (the invalidation below refetches anyway).
      const currentUser = queryClient.getQueryData<SafeCurrentUser | undefined>(
        queryKeys.account.current
      );
      if (currentUser) {
        setCurrentUser({ ...currentUser, name: data.name });
      }
      // also invalidate the explore page list so the new display name reflects there
      // (and account.current: the contract test guards both keys)
      invalidateStylistProfileCaches(queryClient);
    },
  });
}
