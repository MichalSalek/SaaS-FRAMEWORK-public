// UI/features/admin/hooks/useAdminMetrics.ts
// TQ hook for admin dashboard KPI metrics.
// Uses queryOptions() pattern (TQ v5 SSOT — MIG-B1).

import { queryOptions, useQuery } from '@tanstack/react-query';
import { adminGetMetrics_IO } from '../../../../domain/admin/health/adminHealthIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

export type AdminMetricsResponse =
  ADMIN_DTO_API_V1['ADMIN_GET_METRICS']['RESPONSE'];

/* ─── Fetcher ─── */

const fetchAdminMetrics = adminGetMetrics_IO;

/* ─── Query options (reusable — can be used with prefetch) ─── */

const adminMetricsQueryOptions = queryOptions({
  queryKey: queryKeys.admin.metrics,
  queryFn: ({ signal }) => fetchAdminMetrics(undefined, { signal }),
  staleTime: 60_000,
});

/* ─── Hook ─── */

// Called only from admin pages (AdminLayout, permission-guarded server-side).
// The former `enabled` opt-out existed for the mobile admin variant of the
// shared /app dashboard; that variant is gone (admin /app → /app/admin on every
// viewport, useAdminEntryGuard), so the hook has no non-admin caller left.
export function useAdminMetrics() {
  const { data, isLoading, isFetching, isError, refetch } = useQuery(
    adminMetricsQueryOptions
  );

  return {
    metrics: data ?? null,
    isLoading,
    isFetching,
    isError,
    refetch,
  };
}
