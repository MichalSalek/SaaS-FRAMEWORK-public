// UI/features/admin/hooks/useEnableUser.ts
// TQ v5 mutation — POST /api/v1/admin/users/{id}/enable-any
// Invalidates admin.users on success.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { enableUserAny_IO } from '../../../../domain/admin/users/adminUsersIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

type EnableRequest = ADMIN_DTO_API_V1['USER_ENABLE_ANY']['REQUEST'];

const enableUser = enableUserAny_IO;

export function useEnableUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: EnableRequest) => enableUser(req),
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
