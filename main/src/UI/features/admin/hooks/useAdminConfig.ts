// main/src/UI/features/admin/hooks/useAdminConfig.ts
// TanStack Query v5 — query for GET /api/v1/admin/config
import { queryOptions, useQuery } from '@tanstack/react-query';
import { adminGetConfigs_IO } from '../../../../domain/admin/config/adminConfigIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';

const fetchConfigs = adminGetConfigs_IO;

const adminConfigQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.admin.config,
    queryFn: ({ signal }) => fetchConfigs(undefined, { signal }),
    staleTime: 30_000,
  });

export function useAdminConfig() {
  const query = useQuery(adminConfigQueryOptions());
  return {
    configs: query.data?.configs,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  };
}
