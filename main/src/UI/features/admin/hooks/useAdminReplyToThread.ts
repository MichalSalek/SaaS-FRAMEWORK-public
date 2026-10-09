// main/src/UI/features/admin/hooks/useAdminReplyToThread.ts
// TQ v5 mutation — POST /api/v1/admin/support/reply

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { adminReplyToSupportThread_IO } from '../../../../domain/support/supportIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { invalidateAdminAttention } from './useAdminAttentionCounts';
import type { SUPPORT_DTO_API_V1 } from '@kernel/models/support/support.dto';

/* ─── Types ─── */

type ReplyRequest = SUPPORT_DTO_API_V1['SUPPORT_ADMIN_REPLY']['REQUEST'];

/* ─── Hook ─── */

export function useAdminReplyToThread() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: ReplyRequest) => adminReplyToSupportThread_IO(req),
    // AdminSupportThreadPage pokazuje wlasny snackbar w onError (replyError) —
    // bez suppress globalny MutationCache.onError dokladalby drugi, generyczny toast.
    meta: { suppressGlobalError: true },
    onSuccess: (_data, variables) => {
      invalidateAdminAttention(queryClient);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.support.adminThreadMessages(variables.thread_id),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.support.adminThreadsAll,
      });
    },
  });
}
