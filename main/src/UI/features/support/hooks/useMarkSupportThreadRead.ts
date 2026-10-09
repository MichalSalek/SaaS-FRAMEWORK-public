// UI/features/support/hooks/useMarkSupportThreadRead.ts
// TQ v5 mutation -- POST /api/v1/support/mark-thread-read

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { markSupportThreadRead_IO } from '../../../../domain/support/supportIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';

export function useMarkSupportThreadRead() {
  const queryClient = useQueryClient();

  return useMutation({
    // Fired by the thread screen itself, not by a tap: a failure must stay
    // silent (no toast for something the user never asked for). The marker
    // simply stays, and the next open tries again.
    mutationFn: (threadId: string) =>
      markSupportThreadRead_IO(
        { thread_id: threadId },
        { silentBusinessError: true }
      ),
    meta: { suppressGlobalError: true },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.support.threads,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.support.unreadCount,
      });
    },
  });
}
