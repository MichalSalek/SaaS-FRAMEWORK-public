// main/src/UI/features/admin/hooks/useAdminPolicies.ts
// TQ v5 query — GET /api/v1/admin/get-policies
// Stack: TQ v5 queryOptions pattern (SSOT MIG-B1).

import { queryOptions, useQuery } from '@tanstack/react-query';
import { adminGetPolicies_IO } from '../../../../domain/admin/config/adminConfigIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

/* ─── Types ─── */

type AdminPoliciesResponse = ADMIN_DTO_API_V1['ADMIN_GET_POLICIES']['RESPONSE'];
export type AdminPolicy = AdminPoliciesResponse['policies'][0];

/* ─── Fetcher ─── */

const fetchPolicies = adminGetPolicies_IO;

/* ─── Query options (reusable — prefetch-compatible) ─── */

const adminPoliciesQueryOptions = queryOptions({
  queryKey: queryKeys.admin.policies,
  queryFn: ({ signal }) => fetchPolicies(undefined, { signal }),
  staleTime: 30_000,
});

/* ─── Hook ─── */

export function useAdminPolicies() {
  const { data, isLoading, isFetching, isError, refetch } = useQuery(
    adminPoliciesQueryOptions
  );

  return {
    policies: data?.policies ?? null,
    isLoading,
    isFetching,
    isError,
    refetch,
  };
}
