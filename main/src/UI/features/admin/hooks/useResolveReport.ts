// main/src/UI/features/admin/hooks/useResolveReport.ts
// TQ v5 mutation — POST /api/v1/admin/moderation/resolve-report

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { adminResolveReport_IO } from '../../../../domain/moderation/moderationIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { invalidateAdminAttention } from './useAdminAttentionCounts';
import type { MODERATION_DTO_API_V1 } from '@kernel/models/moderation/moderation.dto';

/* ─── Types ─── */

type ResolveRequest = MODERATION_DTO_API_V1['ADMIN_RESOLVE_REPORT']['REQUEST'];

/* ─── Hook ─── */

export function useResolveReport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: ResolveRequest) => adminResolveReport_IO(req),
    // Page provides its own translated onError snackbar; suppress the global
    // fallback to avoid duplicate "general error" toasts on the same failure.
    meta: { suppressGlobalError: true },
    onSuccess: () => {
      invalidateAdminAttention(queryClient);
      // Invalidate all content reports queries (any filter/page combination)
      void queryClient.invalidateQueries({
        queryKey: queryKeys.admin.contentReportsAll,
      });
    },
  });
}
