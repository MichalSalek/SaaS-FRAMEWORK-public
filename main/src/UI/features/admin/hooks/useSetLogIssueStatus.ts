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
    // Hook pokazuje własny komunikat w onError — bez tego globalny
    // MutationCache.onError dokładałby drugi, generyczny toast.
    meta: { suppressGlobalError: true },
    onSuccess: () => {
      invalidateAdminAttention(queryClient);
      // Status żyje w tym samym wierszu co agregat, więc odświeżamy całą rodzinę
      // kluczy grup (dowolne zawężenie filtrów może pokazywać tę samą grupę).
      void queryClient.invalidateQueries({
        queryKey: queryKeys.admin.logGroupsAll,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.admin.logDetailsAll,
      });
    },
    onError: error => {
      // Interceptor HTTP wystawia własny, konkretny komunikat dla błędów IO —
      // generyk tylko wtedy, gdy to NIE był błąd z odpowiedzi (anty-double-toast).
      if (!isIOError(error)) {
        pushNewSnackbar(t('statusSetError'), 'error');
      }
    },
  });
}
