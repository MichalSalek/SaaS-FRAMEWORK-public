// main/src/UI/features/admin/hooks/useSavePermissions.ts
// TanStack Query v5 — mutation for POST /api/v1/admin/permissions (UPDATE_PERMISSIONS)

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { adminUpdatePermissions_IO } from '../../../../domain/admin/config/adminConfigIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

/* ─── Types ─── */

type UpdateRequest = ADMIN_DTO_API_V1['ADMIN_UPDATE_PERMISSIONS']['REQUEST'];

/* ─── Fetcher ─── */

const updatePermissions = adminUpdatePermissions_IO;

/* ─── Hook ─── */

export function useSavePermissions() {
  const queryClient = useQueryClient();
  const permissionsKey = queryKeys.admin.permissions;

  return useMutation({
    mutationFn: (req: UpdateRequest) => updatePermissions(req),
    // suppressGlobalError: the call-site (AdminPermissionsPage.handleSave catch)
    // owns the user-facing error toast (t('saveError')). Without this flag the
    // MutationCache.onError global fallback ALSO fires → double toast (the class
    // queryClient.config.ts warns about; matches every sibling admin mutation hook).
    meta: { suppressGlobalError: true },

    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: permissionsKey });
    },
  });
}
