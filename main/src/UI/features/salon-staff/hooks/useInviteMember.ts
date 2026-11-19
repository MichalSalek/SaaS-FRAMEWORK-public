// UI/features/salon-staff/hooks/useInviteMember.ts
// TQ v5 mutation — POST /api/v1/salon/staff
// Invites a new staff member to the salon by email.
// Stack: TanStack Query v5.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { inviteSalonStaff_IO } from '../../../../domain/salon-staff/salonStaffIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { SALON_STAFF_DTO_API_V1 } from '@kernel/models/salon-staff/salon-staff.dto';
import { trackFlowStep } from '../../../../application/analytics/flow-events';
import { flowErrorCode } from '../../shared/analytics/flowErrorCode';

/* ─── Types ─── */

type InviteRequest = SALON_STAFF_DTO_API_V1['SALON_STAFF_INVITE']['REQUEST'];

/* ─── Hook ─── */

export function useInviteMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: InviteRequest) =>
      inviteSalonStaff_IO(req, { silentBusinessError: true }),
    meta: { suppressGlobalError: true },
    onSuccess: () => {
      trackFlowStep('salon_team', 'invite_sent');
      void queryClient.invalidateQueries({ queryKey: queryKeys.staff.all });
    },
    onError: error => {
      trackFlowStep('salon_team', 'invite_failed', {
        code: flowErrorCode(error),
      });
    },
  });
}
