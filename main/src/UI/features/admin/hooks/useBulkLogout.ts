// UI/features/admin/hooks/useBulkLogout.ts
// TQ v5 mutation — POST /api/v1/admin/users/bulk-logout
// Invalidates admin.users on success (sessions changed).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { adminBulkLogout_IO } from '../../../../domain/admin/users/adminUsersIO.possibilities.api';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

type BulkLogoutRequest = ADMIN_DTO_API_V1['ADMIN_BULK_LOGOUT']['REQUEST'];

const bulkLogout = adminBulkLogout_IO;

export function useBulkLogout() {
  const queryClient = useQueryClient();
  const t = useTranslations('admin.users');

  return useMutation({
    mutationFn: (req: BulkLogoutRequest) => bulkLogout(req),
    // AdminUsersPage owns the user-facing error toast; suppress global fallback.
    meta: { suppressGlobalError: true },
    onSuccess: data => {
      // FDX FAZA 2: specific count snackbar moved here from the IO layer (NOT a
      // duplicate of the BULK_LOGOUT_SUCCESS event the interceptor pushes — it
      // carries affected/sessionsDeleted counts). 1:1 with the pre-migration toast.
      const { affected, sessionsDeleted } = data;
      pushNewSnackbar(
        t('bulkLogoutToast', { affected, sessions: sessionsDeleted }),
        'success'
      );
      void queryClient.invalidateQueries({
        queryKey: queryKeys.admin.usersAll,
      });
    },
  });
}
