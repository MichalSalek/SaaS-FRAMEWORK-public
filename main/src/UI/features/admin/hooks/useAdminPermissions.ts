// main/src/UI/features/admin/hooks/useAdminPermissions.ts
// TanStack Query v5 — query for GET /api/v1/admin/permissions

import { queryOptions, useQuery } from '@tanstack/react-query';
import { adminGetPermissions_IO } from '../../../../domain/admin/config/adminConfigIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

/* ─── Types ─── */

type PermissionsResponse =
  ADMIN_DTO_API_V1['ADMIN_GET_PERMISSIONS']['RESPONSE'];
export type RoleWithPermissions = PermissionsResponse['roles'][number];
export type PermissionView = PermissionsResponse['allPermissions'][number];

/* ─── Fetcher ─── */

const fetchPermissions = adminGetPermissions_IO;

/* ─── Query options (shareable) ─── */

const permissionsQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.admin.permissions,
    queryFn: ({ signal }) => fetchPermissions(undefined, { signal }),
    staleTime: 60_000,
  });

/* ─── Hook ─── */

export function useAdminPermissions() {
  return useQuery(permissionsQueryOptions());
}
