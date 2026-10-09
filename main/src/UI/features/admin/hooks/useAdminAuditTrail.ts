// UI/features/admin/hooks/useAdminAuditTrail.ts
// TQ hook for admin audit trail — server-side pagination + event_name filter.
// Uses queryOptions() pattern (TQ v5 SSOT). Stack: TQ v5 (promise-first IO).

import { queryOptions, useQuery } from '@tanstack/react-query';
import { adminGetAuditTrail_IO } from '../../../../domain/admin/logs/adminLogsIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

export type AuditTrailEntry =
  ADMIN_DTO_API_V1['ADMIN_GET_AUDIT_TRAIL']['RESPONSE']['entries'][number];

export type AuditTrailRequest =
  ADMIN_DTO_API_V1['ADMIN_GET_AUDIT_TRAIL']['REQUEST'];

/* ─── Fetcher ─── */

const fetchAuditTrail = adminGetAuditTrail_IO;

/* ─── Query options ─── */

function auditTrailQueryOptions(params: AuditTrailRequest) {
  return queryOptions({
    queryKey: queryKeys.admin.auditTrail(params),
    queryFn: ({ signal }) => fetchAuditTrail(params, { signal }),
    staleTime: 30_000,
    placeholderData: prev => prev,
  });
}

/* ─── Hook ─── */

export function useAdminAuditTrail(params: AuditTrailRequest) {
  const { data, isLoading, isError, isFetching, isPlaceholderData, refetch } =
    useQuery(auditTrailQueryOptions(params));

  return {
    data: data ?? null,
    isLoading,
    isError,
    isFetching,
    isPlaceholderData,
    refetch,
  };
}
