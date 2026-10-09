// UI/features/admin/hooks/useAdminReports.ts
// TQ hook for admin reports data.
// Uses queryOptions() pattern (TQ v5 SSOT — MIG-B4).

import { queryOptions, useQuery } from '@tanstack/react-query';
import { adminGetReports_IO } from '../../../../domain/admin/logs/adminLogsIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type {
  ADMIN_DTO_API_V1,
  ReportPeriod,
} from '@kernel/models/admin/admin.dto';

export type AdminReportsResponse =
  ADMIN_DTO_API_V1['ADMIN_GET_REPORTS']['RESPONSE'];
export type { ReportPeriod };

/* ─── Fetcher ─── */

const fetchAdminReports = adminGetReports_IO;

/* ─── Query options factory ─── */

const adminReportsQueryOptions = (period: ReportPeriod) =>
  queryOptions({
    queryKey: queryKeys.admin.reports({ period }),
    queryFn: ({ signal }) => fetchAdminReports({ period }, { signal }),
    staleTime: 120_000,
  });

/* ─── Hook ─── */

export function useAdminReports(period: ReportPeriod) {
  const { data, isLoading, isFetching, isError, refetch } = useQuery(
    adminReportsQueryOptions(period)
  );

  return {
    reports: data ?? null,
    isLoading,
    isFetching,
    isError,
    refetch,
  };
}
