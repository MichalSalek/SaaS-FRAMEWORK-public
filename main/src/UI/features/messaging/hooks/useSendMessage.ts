// UI/features/messaging/hooks/useSendMessage.ts
// TQ v5 mutation — POST /api/v1/messaging/send. Po sukcesie invaliduje wątek
// (nowa wiadomość) + listę rozmów (preview/last_message_at/unread). Błędy
// (MESSAGING_NOT_ALLOWED / RATE_LIMITED / PAIR_NOT_FOUND) toastuje interceptor
// HTTP (event-bus Stage 1); meta.suppressGlobalError blokuje drugi toast z TQ.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sendMessage_IO } from '../../../../domain/messaging/messagingIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';

export function useSendMessage(pairId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (content: string) =>
      sendMessage_IO({ pair_id: pairId, content }),
    meta: { suppressGlobalError: true },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.messaging.thread(pairId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.messaging.conversationsAll,
      });
    },
  });
}
