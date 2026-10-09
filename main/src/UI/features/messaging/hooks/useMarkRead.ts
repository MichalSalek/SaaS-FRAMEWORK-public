// UI/features/messaging/hooks/useMarkRead.ts
// TQ v5 mutation — POST /api/v1/messaging/mark-read. Wołane przy otwarciu wątku
// i gdy dojdą nowe wiadomości drugiej strony. Po sukcesie invaliduje listę
// rozmów (zeruje badge unread). Ciche (best-effort, brak toasta).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { markMessagesRead_IO } from '../../../../domain/messaging/messagingIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';

export function useMarkRead() {
  const queryClient = useQueryClient();

  return useMutation({
    // silentBusinessError (S82): "ciche" z nagłówka wyciszało tylko warstwę 3
    // (TQ), a interceptor (warstwa 1) NADAL toastował biznesowe 4xx — np.
    // MESSAGING_PAIR_NOT_FOUND gdy para znikła przy otwartym wątku. Mark-read
    // to best-effort tło; 401/5xx dalej toastują (kontrakt interceptora).
    mutationFn: (pairId: string) =>
      markMessagesRead_IO({ pair_id: pairId }, { silentBusinessError: true }),
    meta: { suppressGlobalError: true },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.messaging.conversationsAll,
      });
    },
  });
}
