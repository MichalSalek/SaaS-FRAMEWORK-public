// UI/features/admin/hooks/useAdminUserTimeline.ts
// TQ v5 hook — GET /api/v1/admin/user/timeline?user_id=...&page=...&limit=...
// Lazy fetch: pass `enabled` to gate the request until the Timeline tab is opened.
// queryKey: queryKeys.admin.userTimeline(params).

import {
  keepPreviousData,
  queryOptions,
  useQuery,
} from '@tanstack/react-query';
import { adminGetUserTimeline_IO } from '../../../../domain/admin/users/adminUsersIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

/* ─── Types ─── */

export type UserTimelineRequest =
  ADMIN_DTO_API_V1['ADMIN_GET_USER_TIMELINE']['REQUEST'];

/* ─── Fetcher ─── */

const fetchTimeline = adminGetUserTimeline_IO;

/* ─── Query options ─── */

const adminUserTimelineQueryOptions = (
  params: UserTimelineRequest,
  enabled: boolean
) =>
  queryOptions({
    queryKey: queryKeys.admin.userTimeline(params),
    queryFn: ({ signal }) => fetchTimeline(params, { signal }),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    enabled,
  });

/* ─── Hook ─── */

export function useAdminUserTimeline(
  params: UserTimelineRequest,
  enabled: boolean
) {
  return useQuery(adminUserTimelineQueryOptions(params, enabled));
}
