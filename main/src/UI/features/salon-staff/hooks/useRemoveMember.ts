// UI/features/salon-staff/hooks/useRemoveMember.ts
// TQ v5 mutation — DELETE /api/v1/salon/staff/[staffId]/delete
// Removes a staff member from the salon.
// Stack: TanStack Query v5.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';
import { removeSalonStaff_IO } from '../../../../domain/salon-staff/salonStaffIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';

/* ─── Hook ─── */

export function useRemoveMember(opts?: {
  successMessageKey?: 'removeSuccess' | 'freeSlotSuccess';
}) {
  const queryClient = useQueryClient();
  const t = useTranslations('salon.staff');

  return useMutation({
    mutationFn: (staffId: string) => removeSalonStaff_IO(staffId)(undefined),
    meta: { suppressGlobalError: true },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.staff.all });
      pushNewSnackbar(t(opts?.successMessageKey ?? 'removeSuccess'), 'success');
    },
    onError: () => {
      pushNewSnackbar(t('removeError'), 'error');
    },
  });
}
