// UI/features/admin/hooks/useDeleteAnyUser.ts
// TQ v5 mutation — POST /api/v1/admin/users/{id}/delete-any
// Destructive admin action. Invalidates admin.users on success.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { deleteUserAny_IO } from '../../../../domain/admin/users/adminUsersIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

type DeleteRequest = ADMIN_DTO_API_V1['USER_DELETE_ANY']['REQUEST'];

const deleteUser = deleteUserAny_IO;

export function useDeleteAnyUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: DeleteRequest) => deleteUser(req),
    // UserDetailsDialog.tabs.tsx (ActionsTab) owns the user-facing error toast; suppress global fallback.
    meta: { suppressGlobalError: true },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.admin.usersAll,
      });
    },
  });
}
