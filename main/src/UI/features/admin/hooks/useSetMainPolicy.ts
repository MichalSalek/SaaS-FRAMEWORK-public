// main/src/UI/features/admin/hooks/useSetMainPolicy.ts
// TQ v5 mutation — POST /api/v1/admin/set-main-policy

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { adminSetMainPolicy_IO } from '../../../../domain/admin/config/adminConfigIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

/* ─── Types ─── */

type SetMainPolicyRequest =
  ADMIN_DTO_API_V1['ADMIN_SET_MAIN_POLICY']['REQUEST'];

/* ─── Fetcher ─── */

const setMainPolicy = adminSetMainPolicy_IO;

/* ─── Hook ─── */

export function useSetMainPolicy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: SetMainPolicyRequest) => setMainPolicy(req),
    // AdminPoliciesPage owns the user-facing error toast; suppress global fallback.
    meta: { suppressGlobalError: true },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.admin.policies,
      });
    },
  });
}
