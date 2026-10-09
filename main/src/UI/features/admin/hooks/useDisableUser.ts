// UI/features/admin/hooks/useDisableUser.ts
// TQ v5 mutation — POST /api/v1/admin/users/{id}/disable-any
// Invalidates admin.users on success.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { disableUserAny_IO } from '../../../../domain/admin/users/adminUsersIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

type DisableRequest = ADMIN_DTO_API_V1['USER_DISABLE_ANY']['REQUEST'];

const disableUser = disableUserAny_IO;

export function useDisableUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: DisableRequest) => disableUser(req),
    // UserDetailsDialog.tabs.tsx (ActionsTab) owns the user-facing error toast; suppress global fallback.
    meta: { suppressGlobalError: true },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.admin.usersAll,
      });
      // Bust account.current so the affected user's state (active/disabled)
      // refreshes immediately rather than after staleTime (60s) — relevant when
      // the admin is acting on their own account or impersonating.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.account.current,
      });
    },
  });
}
