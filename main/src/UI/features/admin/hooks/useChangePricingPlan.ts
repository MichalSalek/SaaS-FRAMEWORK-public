// UI/features/admin/hooks/useChangePricingPlan.ts
// TQ v5 mutation — POST /api/v1/admin/user/change-pricing-plan
// Invalidates admin.users on success.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { adminChangePricingPlan_IO } from '../../../../domain/admin/users/adminUsersIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

type ChangePricingPlanRequest =
  ADMIN_DTO_API_V1['ADMIN_CHANGE_PRICING_PLAN']['REQUEST'];

const changePricingPlan = adminChangePricingPlan_IO;

export function useChangePricingPlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: ChangePricingPlanRequest) => changePricingPlan(req),
    // UserDetailsDialog.tabs.tsx (ActionsTab) owns the user-facing error toast; suppress global fallback.
    meta: { suppressGlobalError: true },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.admin.usersAll,
      });
      // Also bust the affected user's payment-status cache — if the admin is
      // changing their own plan (or impersonating), the paymentStatus query
      // would otherwise show the stale plan for up to staleTime (60s).
      void queryClient.invalidateQueries({
        queryKey: queryKeys.account.paymentStatus,
      });
    },
  });
}
