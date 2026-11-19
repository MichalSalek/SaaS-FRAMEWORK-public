// UI/features/salon-staff/hooks/useRemoveMember.ts
// TQ v5 mutation — DELETE /api/v1/salon/staff/[staffId]/delete
// Removes a staff member from the salon.
// Stack: TanStack Query v5.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { removeSalonStaff_IO } from '../../../../domain/salon-staff/salonStaffIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { trackFlowStep } from '../../../../application/analytics/flow-events';
import { flowErrorCode } from '../../shared/analytics/flowErrorCode';

/* ─── Hook ─── */

export function useRemoveMember(opts?: {
  successMessageKey?: 'removeSuccess' | 'freeSlotSuccess';
}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (staffId: string) => removeSalonStaff_IO(staffId)({}),
    meta: { suppressGlobalError: true },
    onError: error => {
      trackFlowStep('salon_team', 'failed', {
        action: 'remove_member',
        code: flowErrorCode(error),
      });
    },
    onSuccess: () => {
      trackFlowStep('salon_team', 'member_removed', {
        context:
          opts?.successMessageKey === 'freeSlotSuccess' ? 'free_slot' : 'team',
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.staff.all });
    },
  });
}
