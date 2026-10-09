// UI/features/support/hooks/useAddSupportMessage.ts
// TQ v5 mutation -- POST /api/v1/support/add-message

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { addSupportMessage_IO } from '../../../../domain/support/supportIO.possibilities.api';
import { isIOError } from '../../../../application/http/toPromise.adapter';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { SUPPORT_DTO_API_V1 } from '@kernel/models/support/support.dto';

type AddMessageRequest = SUPPORT_DTO_API_V1['SUPPORT_ADD_MESSAGE']['REQUEST'];

export function useAddSupportMessage(threadId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: AddMessageRequest) => addSupportMessage_IO(req),
    meta: { suppressGlobalError: true },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.support.threadMessages(threadId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.support.threads,
      });
    },
    onError: error => {
      // Error toast owned by the HTTP interceptor (event-bus Stage 1): the backend
      // emits SUPPORT_THREAD_CLOSED (thread closed mid-compose, error-mapper) or a
      // generic event, or INTERNET_CONNECTION_PROBLEM on network. A local push
      // stacked a second toast (different key never dedups). We keep ONLY the
      // side-effect: when the thread was closed under the user, refetch so the UI
      // swaps the composer for the closed banner immediately.
      if (
        isIOError(error) &&
        error.httpError.event === APP_EVENTS.INFO.SUPPORT.SUPPORT_THREAD_CLOSED
      ) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.support.threadMessages(threadId),
        });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.support.threads,
        });
      }
    },
  });
}
