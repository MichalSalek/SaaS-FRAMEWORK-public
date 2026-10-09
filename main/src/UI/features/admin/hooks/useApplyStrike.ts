// main/src/UI/features/admin/hooks/useApplyStrike.ts
// TQ v5 mutation — POST /api/v1/admin/moderation/apply-strike

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApplyStrike_IO } from '../../../../domain/moderation/moderationIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { invalidateAdminAttention } from './useAdminAttentionCounts';
import type { MODERATION_DTO_API_V1 } from '@kernel/models/moderation/moderation.dto';

/* ─── Types ─── */

type StrikeRequest = MODERATION_DTO_API_V1['ADMIN_APPLY_STRIKE']['REQUEST'];

/* ─── Hook ─── */

export function useApplyStrike() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: StrikeRequest) => adminApplyStrike_IO(req),
    // Page provides its own translated onError snackbar; suppress the global
    // fallback to avoid duplicate "general error" toasts on the same failure.
    meta: { suppressGlobalError: true },
    onSuccess: () => {
      invalidateAdminAttention(queryClient);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.admin.contentReportsAll,
      });
    },
  });
}
