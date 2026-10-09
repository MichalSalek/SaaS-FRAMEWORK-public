// UI/features/admin/hooks/useAdminEmailHistory.ts
// TQ v5 hook — GET /api/v1/email/get-history?userId={userId}
// Lazy fetch: pass `enabled` to control when the request fires.
// queryKey: queryKeys.admin.emailHistory(userId).

import { queryOptions, useQuery } from '@tanstack/react-query';
import { getEmailHistory_IO } from '../../../../domain/email/emailIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';

/* ─── Query options ─── */

const adminEmailHistoryQueryOptions = (userId: string, enabled: boolean) =>
  queryOptions({
    queryKey: queryKeys.admin.emailHistory(userId),
    queryFn: ({ signal }) => getEmailHistory_IO({ userId }, { signal }),
    staleTime: 30_000,
    enabled,
  });

/* ─── Hook ─── */

export function useAdminEmailHistory(userId: string, enabled: boolean) {
  return useQuery(adminEmailHistoryQueryOptions(userId, enabled));
}
