// UI/features/admin/hooks/useBulkEnable.ts
// TQ v5 mutation — POST /api/v1/admin/users/bulk-enable
// Invalidates admin.users on success.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { adminBulkEnable_IO } from '../../../../domain/admin/users/adminUsersIO.possibilities.api';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

type BulkEnableRequest = ADMIN_DTO_API_V1['ADMIN_BULK_ENABLE']['REQUEST'];

const bulkEnable = adminBulkEnable_IO;

export function useBulkEnable() {
  const queryClient = useQueryClient();
  const t = useTranslations('admin.users');

  return useMutation({
    mutationFn: (req: BulkEnableRequest) => bulkEnable(req),
    // AdminUsersPage owns the user-facing error toast; suppress global fallback.
    meta: { suppressGlobalError: true },
    onSuccess: data => {
      // FDX FAZA 2: specific count snackbar moved here from the IO layer (NOT a
      // duplicate of the BULK_ENABLE_SUCCESS event the interceptor pushes — it
      // carries affected/skipped counts). 1:1 with the pre-migration toast.
      const { affected, skipped, errors } = data;
      pushNewSnackbar(t('bulkEnabledToast', { affected, skipped }), 'success');
      // errors[] = ids the backend could not apply the change to (unknown or
      // deleted account). Without this the toast read as a full success.
      if (errors.length > 0) {
        pushNewSnackbar(
          t('bulkNotAppliedToast', { count: errors.length }),
          'warning'
        );
      }
      void queryClient.invalidateQueries({
        queryKey: queryKeys.admin.usersAll,
      });
      // Bust account.current so the affected user's state (active/disabled)
      // refreshes immediately rather than after staleTime — relevant when the
      // admin's own account or an impersonated account is in the selection.
      // Mirrors single-user useEnableUser.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.account.current,
      });
    },
  });
}
