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
    // One success owner: the users screen states user and session counts (successFeedback, io.ts).
    mutationFn: (req: BulkLogoutRequest) =>
      bulkLogout(req, { successFeedback: 'screen' }),
    // AdminUsersPage owns the user-facing error toast; suppress global fallback.
    meta: { suppressGlobalError: true },
    onSuccess: data => {
      // The specific count snackbar lives here, not in the IO layer (NOT a duplicate of the
      // BULK_LOGOUT_SUCCESS event the interceptor pushes: it carries affected/sessionsDeleted counts).
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
