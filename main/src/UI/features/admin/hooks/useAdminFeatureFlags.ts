// main/src/UI/features/admin/hooks/useAdminFeatureFlags.ts
// TanStack Query v5 — query for GET /api/v1/admin/feature-flags

import { queryOptions, useQuery } from '@tanstack/react-query';
import { adminGetFeatureFlags_IO } from '../../../../domain/admin/config/adminConfigIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

/* ─── Types ─── */

export type FeatureFlagItem =
  ADMIN_DTO_API_V1['ADMIN_GET_FEATURE_FLAGS']['RESPONSE'][number];

/* ─── Fetcher ─── */

const fetchFeatureFlags = adminGetFeatureFlags_IO;

/* ─── Query options (shareable) ─── */

const featureFlagsQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.admin.featureFlags,
    queryFn: ({ signal }) => fetchFeatureFlags(undefined, { signal }),
    staleTime: 30_000,
  });

/* ─── Hook ─── */

export function useAdminFeatureFlags() {
  return useQuery(featureFlagsQueryOptions());
}
