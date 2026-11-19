// main/src/UI/features/admin/hooks/useSetLogIssueStatus.ts
// TQ v5 mutation — POST /api/v1/admin/log-issue-status

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { adminSetLogIssueStatus_IO } from '../../../../domain/admin/logs/adminLogsIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { invalidateAdminAttention } from './useAdminAttentionCounts';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';
import { isIOError } from '../../../../application/http/toPromise.adapter';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

type SetStatusRequest =
  ADMIN_DTO_API_V1['ADMIN_SET_LOG_ISSUE_STATUS']['REQUEST'];

export function useSetLogIssueStatus() {
  const queryClient = useQueryClient();
  const t = useTranslations('admin.logs');

  return useMutation({
    mutationFn: (req: SetStatusRequest) => adminSetLogIssueStatus_IO(req),
    // The hook shows its own message in onError; without this the global MutationCache.onError would
    // add a second, generic toast.
    meta: { suppressGlobalError: true },
    onSuccess: () => {
      invalidateAdminAttention(queryClient);
      // The status lives in the same row as the aggregate, so we refresh the whole family of group keys
      // (any filter narrowing may show the same group).
      void queryClient.invalidateQueries({
        queryKey: queryKeys.admin.logGroupsAll,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.admin.logDetailsAll,
      });
    },
    onError: error => {
      // The HTTP interceptor shows its own specific message for IO errors; the generic one only when
      // this was NOT a response error (anti double-toast).
      if (!isIOError(error)) {
        pushNewSnackbar(t('statusSetError'), 'error');
      }
    },
  });
}
