// main/src/UI/features/admin/hooks/useSavePolicy.ts
// TQ v5 mutation — POST /api/v1/admin/save-policy (upsert: create if no id, update if id)

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { adminSavePolicy_IO } from '../../../../domain/admin/config/adminConfigIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

/* ─── Types ─── */

type SavePolicyRequest = ADMIN_DTO_API_V1['ADMIN_SAVE_POLICY']['REQUEST'];

/* ─── Fetcher ─── */

const savePolicy = adminSavePolicy_IO;

/* ─── Hook ─── */

export function useSavePolicy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: SavePolicyRequest) => savePolicy(req),
    // AdminPoliciesPage owns the user-facing error toast; suppress global fallback.
    meta: { suppressGlobalError: true },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.admin.policies,
      });
    },
  });
}
