// UI/features/support/hooks/useSupportUnreadCount.ts
// TQ v5 query -- GET /api/v1/support/unread-count
// Number of the user's threads with a support reply she has not opened yet.
// The navigation drawer reads the same cache entry (queryKeys.support.unreadCount)
// with its own inline query: components/ may not import a feature hook.

import { queryOptions, useQuery } from '@tanstack/react-query';
import { getSupportUnreadCount_IO } from '../../../../domain/support/supportIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';

const supportUnreadCountQueryOptions = (enabled: boolean) =>
  queryOptions({
    queryKey: queryKeys.support.unreadCount,
    queryFn: ({ signal }) => getSupportUnreadCount_IO(undefined, { signal }),
    enabled,
    staleTime: 60_000,
  });

export function useSupportUnreadCount({
  enabled = true,
}: { enabled?: boolean } = {}) {
  return useQuery(supportUnreadCountQueryOptions(enabled));
}
