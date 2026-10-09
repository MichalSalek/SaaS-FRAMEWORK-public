// UI/features/admin/hooks/useAdminEmailPreview.ts
// TQ v5 hook for the admin email-template preview.
// API: GET /api/v1/admin/mailing/preview?templateId&locale — read-only render.

import { queryOptions, useQuery } from '@tanstack/react-query';
import { adminGetEmailPreview_IO } from '../../../../domain/admin/mailing/adminMailingIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';

export function useAdminEmailPreview(templateId: string, locale: string) {
  const { data, isLoading, isFetching, isError, refetch } = useQuery(
    queryOptions({
      queryKey: queryKeys.admin.emailPreview(templateId, locale),
      queryFn: ({ signal }) =>
        adminGetEmailPreview_IO({ templateId, locale }, { signal }),
      // Templates change only on deploy — cache aggressively, previous locale/
      // template stays warm for instant switching.
      staleTime: 5 * 60 * 1000,
    })
  );

  return {
    preview: data ?? null,
    isLoading,
    isFetching,
    isError,
    refetch,
  };
}
