// UI/features/messaging/hooks/useHideConversation.ts
// D2 (2026-09-05): ukryj / przywróć rozmowę po stronie wołającego (hide = mute).
// Po sukcesie invaliduje OBIE listy rozmów (widoczne + ukryte), wątek (meta
// niesie hidden_at → przełącza akcję Ukryj/Przywróć) i listę oczekujących
// próśb (stylistka: prośba na ukrytej parze znika z listy i dzwonka).
// Błędy toastuje interceptor (warstwa 1); suppressGlobalError blokuje dubel.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  hideConversation_IO,
  unhideConversation_IO,
} from '../../../../domain/messaging/messagingIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';

function useInvalidateAfterHideToggle() {
  const queryClient = useQueryClient();
  return (pairId: string) => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.messaging.conversationsAll,
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.messaging.thread(pairId),
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.pairing.pendingRequests,
    });
  };
}

export function useHideConversation() {
  const invalidate = useInvalidateAfterHideToggle();
  return useMutation({
    mutationFn: (pairId: string) => hideConversation_IO({ pair_id: pairId }),
    meta: { suppressGlobalError: true },
    onSuccess: (_data, pairId) => invalidate(pairId),
  });
}

export function useUnhideConversation() {
  const invalidate = useInvalidateAfterHideToggle();
  return useMutation({
    mutationFn: (pairId: string) => unhideConversation_IO({ pair_id: pairId }),
    meta: { suppressGlobalError: true },
    onSuccess: (_data, pairId) => invalidate(pairId),
  });
}
