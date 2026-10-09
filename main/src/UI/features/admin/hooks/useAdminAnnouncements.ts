// main/src/UI/features/admin/hooks/useAdminAnnouncements.ts
// TQ v5 query - GET /api/v1/admin/announcements
// Stack: TQ v5 queryOptions pattern (SSOT MIG-B1).

import { queryOptions, useQuery } from '@tanstack/react-query';
import { adminGetAnnouncements_IO } from '../../../../domain/admin/announcements/adminAnnouncementsIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { AnnouncementDTO } from '@kernel/models/admin/admin.dto';

/* ─── Types ─── */

export type AdminAnnouncement = AnnouncementDTO;

/* ─── Fetcher ─── */

const fetchAnnouncements = adminGetAnnouncements_IO;

/* ─── Query options (reusable - prefetch-compatible) ─── */

const adminAnnouncementsQueryOptions = queryOptions({
  queryKey: queryKeys.admin.announcements,
  queryFn: ({ signal }) => fetchAnnouncements(undefined, { signal }),
  staleTime: 30_000,
});

/* ─── Hook ─── */

export function useAdminAnnouncements() {
  const { data, isLoading, isFetching, isError, refetch } = useQuery(
    adminAnnouncementsQueryOptions
  );

  return {
    announcements: data ?? null,
    isLoading,
    isFetching,
    isError,
    refetch,
  };
}
