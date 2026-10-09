import { queryOptions, useQuery } from '@tanstack/react-query';
import { getLogs_IO } from '../../../../domain/admin/logs/adminLogsIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

/**
 * Wymiary zawężane po stronie serwera. Wchodzą do klucza zapytania, więc każda
 * zmiana pobiera NOWE okno rekordów zamiast filtrować stare.
 */
export type AdminLogsScope = ADMIN_DTO_API_V1['GET_LOGS']['REQUEST'];

const adminLogsQueryOptions = (scope: AdminLogsScope) =>
  queryOptions({
    queryKey: queryKeys.admin.logs(scope),
    queryFn: ({ signal }) => getLogs_IO(scope, { signal }),
    staleTime: 30_000,
  });

export function useAdminLogs(scope: AdminLogsScope, enabled: boolean) {
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    ...adminLogsQueryOptions(scope),
    enabled,
  });

  return {
    records: data?.records ?? null,
    nextCursor: data?.nextCursor ?? null,
    totalCount: data?.totalCount ?? null,
    oldestRecordDate: data?.oldestRecordDate ?? null,
    isLoading,
    isFetching,
    isError,
    refetch,
  } as const;
}
