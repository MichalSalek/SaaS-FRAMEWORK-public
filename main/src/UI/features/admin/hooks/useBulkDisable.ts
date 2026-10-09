// UI/features/admin/hooks/useBulkDisable.ts
// TQ v5 mutation — POST /api/v1/admin/users/bulk-disable
// Invalidates admin.users on success.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { adminBulkDisable_IO } from '../../../../domain/admin/users/adminUsersIO.possibilities.api';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

type BulkDisableRequest = ADMIN_DTO_API_V1['ADMIN_BULK_DISABLE']['REQUEST'];

const bulkDisable = adminBulkDisable_IO;

export function useBulkDisable() {
  const queryClient = useQueryClient();
  const t = useTranslations('admin.users');

  return useMutation({
    mutationFn: (req: BulkDisableRequest) => bulkDisable(req),
    // AdminUsersPage owns the user-facing error toast; suppress global fallback.
    meta: { suppressGlobalError: true },
    onSuccess: data => {
      // FDX FAZA 2: specific count snackbar moved here from the IO layer (NOT a
      // duplicate of the BULK_DISABLE_SUCCESS event the interceptor pushes — it
      // carries affected/skipped counts). 1:1 with the pre-migration toast.
      const { affected, skipped, errors } = data;
      pushNewSnackbar(t('bulkDisabledToast', { affected, skipped }), 'success');
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
      // Mirrors single-user useDisableUser.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.account.current,
      });
    },
  });
}
