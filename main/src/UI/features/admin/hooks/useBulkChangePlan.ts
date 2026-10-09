// UI/features/admin/hooks/useBulkChangePlan.ts
// TQ v5 mutation — POST /api/v1/admin/users/bulk-change-plan
// Invalidates admin.users on success.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { adminBulkChangePlan_IO } from '../../../../domain/admin/users/adminUsersIO.possibilities.api';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

type BulkChangePlanRequest =
  ADMIN_DTO_API_V1['ADMIN_BULK_CHANGE_PLAN']['REQUEST'];

const bulkChangePlan = adminBulkChangePlan_IO;

export function useBulkChangePlan() {
  const queryClient = useQueryClient();
  const t = useTranslations('admin.users');

  return useMutation({
    mutationFn: (req: BulkChangePlanRequest) => bulkChangePlan(req),
    // AdminUsersPage owns the user-facing error toast; suppress global fallback.
    meta: { suppressGlobalError: true },
    onSuccess: data => {
      // FDX FAZA 2: specific count snackbar moved here from the IO layer (NOT a
      // duplicate of the BULK_CHANGE_PLAN_SUCCESS event the interceptor pushes —
      // it carries affected/skipped counts). 1:1 with the pre-migration toast.
      const { affected, skipped, errors } = data;
      pushNewSnackbar(
        t('bulkPlanChangedToast', { affected, skipped }),
        'success'
      );
      // errors[] = ids the plan could not be applied to (no stylist account,
      // deleted or unknown). Without this the toast read as a full success.
      if (errors.length > 0) {
        pushNewSnackbar(
          t('bulkNotAppliedToast', { count: errors.length }),
          'warning'
        );
      }
      void queryClient.invalidateQueries({
        queryKey: queryKeys.admin.usersAll,
      });
      // Bust account.current + account.paymentStatus so the affected user's
      // state and plan refresh immediately rather than after staleTime —
      // relevant when the admin's own account or an impersonated account is in
      // the selection. Mirrors single-user useChangePricingPlan (paymentStatus)
      // + useDisableUser/useEnableUser (current).
      void queryClient.invalidateQueries({
        queryKey: queryKeys.account.current,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.account.paymentStatus,
      });
    },
  });
}
