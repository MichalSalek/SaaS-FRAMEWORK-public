import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { dismissGalleryStrength_IO } from '../../../../domain/account/accountIO.possibilities.api';
import type { ACCOUNT_DTO_API_V1 } from '@kernel/models/account/account.dto';

type DashboardFeed =
  ACCOUNT_DTO_API_V1['ACCOUNT_GET_DASHBOARD_FEED']['RESPONSE'];

/**
 * Dismisses the "Siła galerii" card (the stylist's decision, stored in the DB).
 *
 * The card disappears at once, optimistically: it is a dismiss gesture, not a
 * data save, and a second of delay would read as a broken close button. An
 * error rolls the update back and says so.
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
