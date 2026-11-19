// main/src/UI/features/admin/hooks/useModerationReports.ts
// TQ v5 query — GET /api/v1/admin/moderation/reports (paginated, filterable by status)

import {
  keepPreviousData,
  queryOptions,
  useQuery,
} from '@tanstack/react-query';
import { adminGetContentReports_IO } from '../../../../domain/moderation/moderationIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { MODERATION_DTO_API_V1 } from '@kernel/models/moderation/moderation.dto';

/* ─── Types ─── */

type ReportsRequest =
  MODERATION_DTO_API_V1['ADMIN_GET_CONTENT_REPORTS']['REQUEST'];
type ReportsResponse =
  MODERATION_DTO_API_V1['ADMIN_GET_CONTENT_REPORTS']['RESPONSE'];
export type ContentReportItem = ReportsResponse['reports'][number];

/* ─── Query options factory ─── */

const moderationReportsQueryOptions = (params: ReportsRequest) =>
  queryOptions({
    queryKey: queryKeys.admin.contentReports(params),
    queryFn: ({ signal }) => adminGetContentReports_IO(params, { signal }),
    staleTime: 30_000,
    // Keep the previous page/filter rows on screen while the next query loads,
    // so pagination and tab switches don't flash the full skeleton each time.
    placeholderData: keepPreviousData,
  });

/* ─── Hook ─── */

export function useModerationReports(params: ReportsRequest) {
  const { data, isLoading, isFetching, isError, isPlaceholderData, refetch } =
    useQuery(moderationReportsQueryOptions(params));

  return {
    reports: data?.reports ?? [],
    totalCount: data?.total_count ?? 0,
    /** Rows on screen are the previous page/filter kept while this one loads. */
    isPlaceholderData,
    hasData: data !== undefined,
    isLoading,
    isFetching,
    isError,
    refetch,
  } as const;
}
