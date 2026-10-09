// UI/features/salon-staff/hooks/useInviteMember.ts
// TQ v5 mutation — POST /api/v1/salon/staff
// Invites a new staff member to the salon by email.
// Stack: TanStack Query v5.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';
import { inviteSalonStaff_IO } from '../../../../domain/salon-staff/salonStaffIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { SALON_STAFF_DTO_API_V1 } from '@kernel/models/salon-staff/salon-staff.dto';

/* ─── Types ─── */

type InviteRequest = SALON_STAFF_DTO_API_V1['SALON_STAFF_INVITE']['REQUEST'];

/* ─── Hook ─── */

export function useInviteMember() {
  const queryClient = useQueryClient();
  const t = useTranslations('salon.staff');

  return useMutation({
    mutationFn: (req: InviteRequest) => inviteSalonStaff_IO(req),
    meta: { suppressGlobalError: true },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.staff.all });
      pushNewSnackbar(t('inviteSuccess'), 'success');
    },
    onError: () => {
      pushNewSnackbar(t('inviteError'), 'error');
    },
  });
}
