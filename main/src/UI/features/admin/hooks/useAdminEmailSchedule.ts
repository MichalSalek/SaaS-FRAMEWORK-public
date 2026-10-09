// UI/features/admin/hooks/useAdminEmailSchedule.ts
// TQ v5 hook for admin email schedule (trial + cancel sequences).
// API: GET /api/v1/email/get-schedule — read-only, no mutations.

import { queryOptions, useQuery } from '@tanstack/react-query';
import { getEmailSchedule_IO } from '../../../../domain/email/emailIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';

/* ─── Query options ─── */

const adminEmailScheduleQueryOptions = queryOptions({
  queryKey: queryKeys.admin.emailSchedule,
  queryFn: ({ signal }) => getEmailSchedule_IO({}, { signal }),
  staleTime: 5 * 60 * 1000, // 5 min — schedule rarely changes
});

/* ─── Hook ─── */

export function useAdminEmailSchedule() {
  const { data, isLoading, isFetching, isError, refetch } = useQuery(
    adminEmailScheduleQueryOptions
  );

  return {
    schedule: data?.schedule ?? null,
    cancelSchedule: data?.cancelSchedule ?? null,
    isLoading,
    isFetching,
    isError,
    refetch,
  };
}
