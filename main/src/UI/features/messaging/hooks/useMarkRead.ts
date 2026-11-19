// TQ v5 mutation: POST /api/v1/messaging/mark-read. Called when a thread opens and
// when new messages from the other side arrive. On success it invalidates the
// conversation list (clears the unread badge). Silent (best-effort, no toast).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { markMessagesRead_IO } from '../../../../domain/messaging/messagingIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';

export function useMarkRead() {
  const queryClient = useQueryClient();

  return useMutation({
    // silentBusinessError: "silent" in the header only muted layer 3 (TQ), while
    // the interceptor (layer 1) STILL toasted business 4xx, e.g.
    // MESSAGING_PAIR_NOT_FOUND when the pair vanished with the thread open.
    // Mark-read is best-effort background; 401/5xx still toast (interceptor contract).
    mutationFn: (input: { pairId: string; readThrough: string | Date }) =>
      markMessagesRead_IO(
        { pair_id: input.pairId, read_through: input.readThrough },
        { silentBusinessError: true }
      ),
    meta: { suppressGlobalError: true },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.messaging.conversationsAll,
      });
      // Reading the thread closes its „napisała do Ciebie” notification.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.all,
      });
    },
  });
}
