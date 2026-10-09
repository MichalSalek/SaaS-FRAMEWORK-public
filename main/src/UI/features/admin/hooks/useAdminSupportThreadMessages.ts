// main/src/UI/features/admin/hooks/useAdminSupportThreadMessages.ts
// TQ v5 query — GET /api/v1/admin/support/thread-messages?thread_id=

import { queryOptions, useQuery } from '@tanstack/react-query';
import { adminGetSupportThreadMessages_IO } from '../../../../domain/support/supportIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
/* ─── Query options factory ─── */

const adminSupportThreadMessagesQueryOptions = (threadId: string) =>
  queryOptions({
    queryKey: queryKeys.support.adminThreadMessages(threadId),
    queryFn: ({ signal }) =>
      adminGetSupportThreadMessages_IO({ thread_id: threadId }, { signal }),
    staleTime: 15_000,
    enabled: Boolean(threadId),
  });

/* ─── Hook ─── */

export function useAdminSupportThreadMessages(threadId: string) {
  const { data, isLoading, isFetching, isError, refetch } = useQuery(
    adminSupportThreadMessagesQueryOptions(threadId)
  );

  return {
    messages: data?.messages ?? [],
    // Typ plynie z kernel DTO (ADMIN_GET_THREAD_MESSAGES.RESPONSE) — bez castow.
    thread: data?.thread,
    hasData: data !== undefined,
    isLoading,
    isFetching,
    isError,
    refetch,
  } as const;
}
