import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { dismissGalleryStrength_IO } from '../../../../domain/account/accountIO.possibilities.api';
import type { ACCOUNT_DTO_API_V1 } from '@kernel/models/account/account.dto';

type DashboardFeed =
  ACCOUNT_DTO_API_V1['ACCOUNT_GET_DASHBOARD_FEED']['RESPONSE'];

/**
 * Zamknięcie karty „Siła galerii" (decyzja stylistki, zapis w bazie).
 *
 * Karta znika od razu — optymistycznie, bez czekania na odpowiedź — bo to
 * gest zamknięcia, a nie zapis danych: sekunda oporu czytałaby się jak
 * zepsuty krzyżyk. Błąd cofa podmianę i mówi o tym wprost.
 */
export function useDismissGalleryStrength(): {
  dismiss: () => void;
  isDismissing: boolean;
} {
  const queryClient = useQueryClient();
  const t = useTranslations('galleryStrength');

  const mutation = useMutation({
    mutationFn: () => dismissGalleryStrength_IO({}),
    meta: { suppressGlobalError: true },
    onMutate: async () => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.account.dashboardFeed,
      });
      const previous = queryClient.getQueryData<DashboardFeed>(
        queryKeys.account.dashboardFeed
      );
      queryClient.setQueryData<DashboardFeed>(
        queryKeys.account.dashboardFeed,
        current =>
          current === undefined
            ? current
            : { ...current, gallery_strength_dismissed: true }
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(
          queryKeys.account.dashboardFeed,
          context.previous
        );
      }
      pushNewSnackbar(t('dismissError'), 'error');
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.account.dashboardFeed,
      });
    },
  });

  return { dismiss: () => mutation.mutate(), isDismissing: mutation.isPending };
}
