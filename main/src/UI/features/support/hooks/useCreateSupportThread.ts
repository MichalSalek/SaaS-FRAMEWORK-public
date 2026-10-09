// UI/features/support/hooks/useCreateSupportThread.ts
// TQ v5 mutation -- POST /api/v1/support/create-thread

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createSupportThread_IO } from '../../../../domain/support/supportIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { SUPPORT_DTO_API_V1 } from '@kernel/models/support/support.dto';

type CreateThreadRequest =
  SUPPORT_DTO_API_V1['SUPPORT_CREATE_THREAD']['REQUEST'];

export function useCreateSupportThread() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: CreateThreadRequest) => createSupportThread_IO(req),
    // suppressGlobalError + no local onError: the HTTP interceptor (event-bus
    // Stage 1) owns the error toast (backend event or INTERNET_CONNECTION_PROBLEM).
    // suppressGlobalError disables the global MutationCache fallback; a local push
    // here duplicated the interceptor (GENERAL_ERROR twice on a generic failure).
    meta: { suppressGlobalError: true },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.support.threads,
      });
    },
  });
}
