import { queryOptions, useQuery } from '@tanstack/react-query';
import { adminGetLogDetails_IO } from '../../../../domain/admin/logs/adminLogsIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';

export function useAdminLogDetails(logId: string | null, enabled: boolean) {
  const id = logId !== null && /^\d+$/.test(logId) ? Number(logId) : null;

  const query = useQuery({
    ...queryOptions({
      queryKey: queryKeys.admin.logDetails(id ?? 0),
      queryFn: ({ signal }) =>
        adminGetLogDetails_IO({ id: id ?? 0 }, { signal }),
      staleTime: 15_000,
    }),
    enabled: enabled && id !== null,
  });

  return query;
}
