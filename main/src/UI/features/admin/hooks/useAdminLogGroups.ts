// main/src/UI/features/admin/hooks/useAdminLogGroups.ts
// TQ v5 query — GET /api/v1/admin/log-groups (agregacja po odcisku palca błędu).

import { queryOptions, useQuery } from '@tanstack/react-query';
import { adminGetLogGroups_IO } from '../../../../domain/admin/logs/adminLogsIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

export type AdminLogGroupsScope =
  ADMIN_DTO_API_V1['ADMIN_GET_LOG_GROUPS']['REQUEST'];

const adminLogGroupsQueryOptions = (
  scope: AdminLogGroupsScope,
  enabled: boolean
) =>
  queryOptions({
    queryKey: queryKeys.admin.logGroups(scope),
    queryFn: ({ signal }) => adminGetLogGroups_IO(scope, { signal }),
    // Agregacja skanuje całą tabelę logów, więc nie odpalamy jej dopóki admin
    // faktycznie nie przełączy się na widok grup.
    enabled,
    staleTime: 30_000,
  });

export function useAdminLogGroups(
  scope: AdminLogGroupsScope,
  enabled: boolean
) {
  const { data, isLoading, isError, isFetching, refetch } = useQuery(
    adminLogGroupsQueryOptions(scope, enabled)
  );

  return {
    groups: data?.groups ?? null,
    totalGroups: data?.totalGroups ?? 0,
    isLoading,
    isFetching,
    isError,
    refetch,
  } as const;
}
