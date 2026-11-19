// UI/features/admin/hooks/useAdminEmailPipeline.ts
// TQ v5 hook for the admin email pipeline: last sweep, today's and tomorrow's
// queue (dry run, nothing is sent) and the first-month code stats.

import { queryOptions, useQuery } from '@tanstack/react-query';
import { adminGetEmailPipeline_IO } from '../../../../domain/admin/mailing/adminMailingIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';

const adminEmailPipelineQueryOptions = queryOptions({
  queryKey: queryKeys.admin.emailPipeline,
  queryFn: ({ signal }) => adminGetEmailPipeline_IO(undefined, { signal }),
  // Short: the queue changes as the clock moves and as mails go out.
  staleTime: 60 * 1000,
});

export function useAdminEmailPipeline() {
  const { data, isLoading, isFetching, isError, refetch } = useQuery(
    adminEmailPipelineQueryOptions
  );
  return { pipeline: data ?? null, isLoading, isFetching, isError, refetch };
}
