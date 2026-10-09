// main/src/UI/features/admin/hooks/useDeletePolicy.ts
// TQ v5 mutation — POST /api/v1/admin/delete-policy

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { adminDeletePolicy_IO } from '../../../../domain/admin/config/adminConfigIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

/* ─── Types ─── */

type DeletePolicyRequest = ADMIN_DTO_API_V1['ADMIN_DELETE_POLICY']['REQUEST'];

/* ─── Fetcher ─── */

const deletePolicy = adminDeletePolicy_IO;

/* ─── Hook ─── */

export function useDeletePolicy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: DeletePolicyRequest) => deletePolicy(req),
    // AdminPoliciesPage owns the user-facing error toast; suppress global fallback.
    meta: { suppressGlobalError: true },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.admin.policies,
      });
    },
  });
}
