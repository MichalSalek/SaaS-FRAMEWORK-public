// main/src/UI/features/announcements/hooks/useActiveAnnouncements.ts
// TQ v5 query — GET /api/v1/announcements/active (public, no auth required)
// Stack: TQ v5 queryOptions pattern.

import { queryOptions, useQuery } from '@tanstack/react-query';
import { getActiveAnnouncements_IO } from '../../../../domain/admin/announcements/adminAnnouncementsIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { backgroundQueryRetryOptions } from '../../../../application/http/background-retry-policy';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

/* ─── Types ─── */

export type ActiveAnnouncement =
  ADMIN_DTO_API_V1['ANNOUNCEMENTS_GET_ACTIVE']['RESPONSE'][number];

/* ─── Fetcher ─── */

const fetchActiveAnnouncements = getActiveAnnouncements_IO;

/* ─── Query options (reusable - prefetch-compatible) ─── */

const activeAnnouncementsQueryOptions = queryOptions({
  queryKey: queryKeys.public.activeAnnouncements,
  queryFn: ({ signal }) => fetchActiveAnnouncements(undefined, { signal }),
  // Announcements change rarely — 5 min staleTime avoids refetching on every page.
  staleTime: 5 * 60 * 1000,
  // No need to refetch on window focus — banners are editorial content, not live data.
  refetchOnWindowFocus: false,
  ...backgroundQueryRetryOptions,
});

/* ─── Hook ─── */

export function useActiveAnnouncements() {
  const { data, isLoading, isError } = useQuery(
    activeAnnouncementsQueryOptions
  );

  return {
    announcements: data ?? [],
    isLoading,
    isError,
  };
}
