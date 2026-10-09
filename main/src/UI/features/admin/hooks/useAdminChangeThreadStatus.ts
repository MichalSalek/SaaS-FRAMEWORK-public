// main/src/UI/features/admin/hooks/useAdminChangeThreadStatus.ts
// TQ v5 mutation — POST /api/v1/admin/support/change-status

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { changeSupportThreadStatus_IO } from '../../../../domain/support/supportIO.possibilities.api';
import { isIOError } from '../../../../application/http/toPromise.adapter';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { invalidateAdminAttention } from './useAdminAttentionCounts';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { SUPPORT_DTO_API_V1 } from '@kernel/models/support/support.dto';

/* ─── Types ─── */

type ChangeStatusRequest =
  SUPPORT_DTO_API_V1['SUPPORT_CHANGE_STATUS']['REQUEST'];

/* ─── Stale-conflict detection ─── */

// Optimistic-concurrency (finding support-1): backend odrzuca stale change-status
// (CHANGE_STATUS.expected_updated_at != aktualny updated_at watku) jako 409 Conflict
// z eventem ALREADY_PROCESSED (handler change-status/index.ts — lokalne mapowanie
// SUPPORT_THREAD_STALE, dopoki kernel nie wchlonie dedykowanego eventu).
const isThreadStaleError = (error: unknown): boolean =>
  isIOError(error) &&
  error.httpError.event === APP_EVENTS.INFO.APPLICATION.ALREADY_PROCESSED;

/* ─── Hook ─── */

export function useAdminChangeThreadStatus() {
  const queryClient = useQueryClient();
  const t = useTranslations('admin.support');

  return useMutation({
    mutationFn: (req: ChangeStatusRequest) => changeSupportThreadStatus_IO(req),
    // Hook pokazuje wlasny, przetlumaczony snackbar w onError — bez suppress
    // globalny MutationCache.onError dokladalby drugi, generyczny toast.
    meta: { suppressGlobalError: true },
    onSuccess: (_data, variables) => {
      invalidateAdminAttention(queryClient);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.support.adminThreadMessages(variables.thread_id),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.support.adminThreadsAll,
      });
    },
    onError: (error, variables) => {
      // 409 STALE: watek zmienil sie od zaladowania widoku (np. swieza odpowiedz
      // usera) — komunikat + refetch, zeby admin zobaczyl aktualny stan i swiezy
      // token updated_at przed ponowieniem.
      if (isThreadStaleError(error)) {
        pushNewSnackbar(t('statusStale'), 'error');
        void queryClient.invalidateQueries({
          queryKey: queryKeys.support.adminThreadMessages(variables.thread_id),
        });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.support.adminThreadsAll,
        });
        return;
      }
      pushNewSnackbar(t('statusChangeError'), 'error');
    },
  });
}
