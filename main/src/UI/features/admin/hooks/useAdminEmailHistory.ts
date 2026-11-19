// UI/features/admin/hooks/useAdminEmailHistory.ts
// TQ v5 hook — GET /api/v1/admin/email-history?user_id={userId}
// Lazy fetch: pass `enabled` to control when the request fires.
// queryKey: queryKeys.admin.emailHistory(userId).

import { queryOptions, useQuery } from '@tanstack/react-query';
import { adminGetEmailHistory_IO } from '../../../../domain/admin/mailing/adminMailingIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';

const adminEmailHistoryQueryOptions = (userId: string, enabled: boolean) =>
  queryOptions({
    queryKey: queryKeys.admin.emailHistory(userId),
    queryFn: ({ signal }) =>
      adminGetEmailHistory_IO({ user_id: userId }, { signal }),
    staleTime: 30_000,
    enabled,
  });

/* ─── Hook ─── */

export function useAdminEmailHistory(userId: string, enabled: boolean) {
  return useQuery(adminEmailHistoryQueryOptions(userId, enabled));
}
