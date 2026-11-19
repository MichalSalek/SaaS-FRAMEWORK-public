// UI/features/support/hooks/useSupportThreadMessages.ts
// TQ v5 query -- GET /api/v1/support/thread-messages?thread_id=
// Fetches messages for a specific support thread.

import { queryOptions, useQuery } from '@tanstack/react-query';
import { getSupportThreadMessages_IO } from '../../../../domain/support/supportIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';

/* --- Query options factory --- */

// `threadId` MUST be a defined, non-empty string. Callers are responsible for
// not invoking this hook until the route param resolves — otherwise an empty
// segment ('') would register a bogus cache entry under
// [SUPPORT,'threadMessages',''] that could shadow a legit fetch on fast
// re-mount (Capacitor history-back). See SupportThreadDetailPage: the messages
// section is gated behind `threadId !== undefined`.
const supportThreadMessagesQueryOptions = (threadId: string) =>
  queryOptions({
    queryKey: queryKeys.support.threadMessages(threadId),
    queryFn: ({ signal }) =>
      getSupportThreadMessages_IO({ thread_id: threadId }, { signal }),
    staleTime: 15_000,
  });

/* --- Hook --- */

export function useSupportThreadMessages(threadId: string) {
  return useQuery(supportThreadMessagesQueryOptions(threadId));
}
